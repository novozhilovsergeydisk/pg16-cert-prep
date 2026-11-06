const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { chromium } = require('playwright');
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');
let server, base, browser;
async function query(sql, args) {
    try { return await pool.query(sql, args); }
    catch { throw new Error('Exam review fixture query failed'); }
}
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
});
after(async () => {
    await browser?.close();
    if (server) await new Promise(r => server.close(r));
    await pool.end();
});
async function user() {
    const id = (await query("INSERT INTO users(email,role) VALUES($1,'user') RETURNING id", ['review-' + crypto.randomUUID() + '@example.test'])).rows[0].id;
    const token = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest(), id]);
    return { id, token };
}
async function fixture(t) {
    const owner = await user(), other = await user();
    const q = (await query(`INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes)
        VALUES(1,$1,$2,'AC',$3,$4) RETURNING *`, ['Снимок экзамена ' + crypto.randomUUID(),
        JSON.stringify({ A: 'Первый вариант', B: 'Второй вариант', C: 'Третий вариант', D: 'Четвёртый вариант', E: 'Пятый вариант' }),
        'Пояснение до изменения', JSON.stringify({ A: 'Да A', B: 'Нет B', C: 'Да C', D: 'Нет D', E: 'Нет E' })])).rows[0];
    t.after(async () => {
        await query('DELETE FROM users WHERE id=ANY($1::int[])', [[owner.id, other.id]]);
        await query('DELETE FROM questions WHERE id=$1', [q.id]);
    });
    const payload = { submission_id: crypto.randomUUID(), answers: [{ question_id: q.id, answer: 'B', order: ['E', 'D', 'C', 'B', 'A'] }], duration_seconds: 17 };
    return { owner, other, q, payload };
}
async function request(path, u, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
        headers: { ...(u ? { Cookie: 'sid=' + u.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
}
const finish = (f, body = f.payload, owner = f.owner) => request('/api/exam/check', owner, body);

test('Concurrent completion writes one snapshot and one answer; mismatched replay is rejected', async t => {
    const f = await fixture(t);
    const replies = await Promise.all([finish(f), finish(f)]);
    assert.equal(replies[0].status, 200); assert.deepEqual(replies[1], replies[0]);
    assert.equal((await query('SELECT count(*)::int AS n FROM exam_history WHERE user_id=$1', [f.owner.id])).rows[0].n, 1);
    assert.equal((await query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1', [f.owner.id])).rows[0].n, 1);
    assert.deepEqual(replies[0].body.questions[0].order, f.payload.answers[0].order);
    assert.equal((await finish(f, { ...f.payload, answers: [{ ...f.payload.answers[0], answer: 'AC' }] })).status, 409);
});

test('Snapshot and replay survive source edits and deletion; owner boundary and legacy rows', async t => {
    const f = await fixture(t), completed = await finish(f);
    const path = '/api/exam/history/' + completed.body.history_id;
    await query("UPDATE questions SET question_text='Изменено',options=$2,correct_answer='B',explanation='Новое' WHERE id=$1", [f.q.id, JSON.stringify({ A: 'Другое A', B: 'Другое B' })]);
    assert.deepEqual((await request(path, f.owner)).body, completed.body);
    await query('DELETE FROM questions WHERE id=$1', [f.q.id]);
    assert.deepEqual((await finish(f)).body, completed.body);
    assert.deepEqual((await request(path, f.owner)).body, completed.body);
    const denied = await request(path, f.other);
    assert.equal(denied.status, 404);
    assert.deepEqual(await request('/api/exam/history/9223372036854775807', f.owner), denied);
    assert.equal((await request(path)).status, 401);
    const legacy = (await query('INSERT INTO exam_history(user_id,total,correct,percent,passed) VALUES($1,1,0,0,false) RETURNING id', [f.owner.id])).rows[0].id;
    const history = (await request('/api/exam/history', f.owner)).body;
    assert.equal(history.find(r => r.id === legacy).has_review, false);
    assert.equal(history.find(r => r.id === completed.body.history_id).has_review, true);
    assert.equal((await request('/api/exam/history/' + legacy, f.owner)).status, 404);
});

test('Invalid order/id is rejected; null answers and five-option multiple answers are preserved', async t => {
    const f = await fixture(t);
    for (const order of [null, ['A'], ['A','A','C','D','E'], ['A','B','C','D','X']]) {
        assert.equal((await finish(f, { ...f.payload, answers: [{ ...f.payload.answers[0], order }] })).status, 400);
    }
    assert.equal((await finish(f, { ...f.payload, submission_id: 'invalid' })).status, 400);
    const skipped = await finish(f, { ...f.payload, answers: [{ ...f.payload.answers[0], answer: null }] });
    assert.equal(skipped.body.results[0].answer, null);
    assert.equal(skipped.body.correct, 0);
    const correct = await finish(f, { ...f.payload, submission_id: crypto.randomUUID(), answers: [{ ...f.payload.answers[0], answer: 'CA' }] });
    assert.equal(correct.body.correct, 1);
    assert.equal(correct.body.results[0].answer, 'AC');
});

test('An answer-log failure rolls back history; retry can commit the same submission', async t => {
    const f = await fixture(t);
    const original = pool.connect;
    pool.connect = function (...args) {
        if (args.length) return original.apply(this, args);
        return original.call(this).then(client => {
            const originalQuery = client.query, originalRelease = client.release;
            client.query = function (sql, params) {
                if (sql.startsWith('INSERT INTO answer_log')) return Promise.reject(Object.assign(new Error(), { code: 'XX000' }));
                return originalQuery.call(this, sql, params);
            };
            client.release = function (...releaseArgs) {
                client.query = originalQuery; client.release = originalRelease;
                return originalRelease.apply(this, releaseArgs);
            };
            return client;
        });
    };
    let failed;
    try { failed = await finish(f); } finally { pool.connect = original; }
    assert.equal(failed.status, 500);
    assert.match(failed.body.error, /Повторите отправку/);
    assert.equal((await query('SELECT count(*)::int AS n FROM exam_history WHERE user_id=$1', [f.owner.id])).rows[0].n, 0);
    assert.equal((await finish(f)).status, 200);
});

for (const width of [320, 390, 1280]) test('History opens an immutable review after reload at ' + width + 'px', async t => {
    const f = await fixture(t), completed = await finish(f);
    await query('INSERT INTO exam_history(user_id,total,correct,percent,passed) VALUES($1,1,0,0,false)', [f.owner.id]);
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    t.after(() => context.close());
    await context.addCookies([{ name: 'sid', value: f.owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', () => errors.push(true));
    await page.goto(base + '/#/results'); await page.locator('#open-history').click();
    await page.locator('#history-list button').waitFor();
    assert.match(await page.locator('#history-list').textContent(), /Сохранена только сводка/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.locator('#history-list button').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#score-errors').textContent(), new RegExp(f.q.question_text));
    assert.match(await page.locator('#score-errors').textContent(), /Пояснение до изменения/);
    assert.match(await page.locator('#score-detail').textContent(), /0 из 1/);
    await page.locator('#result-back').click(); await page.locator('#history-list button').waitFor();
    await page.reload(); await page.locator('#open-history').click(); await page.locator('#history-list button').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    const dir = 'docs/reviews/2026-11-06-ux-stage3b'; fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: dir + '/review-' + width + '.png', fullPage: true });
    await page.locator('#result-back').click(); await page.locator('#history-list button').waitFor();
    await page.screenshot({ path: dir + '/history-' + width + '.png', fullPage: true });
    assert.equal(errors.length, 0);
    assert.equal((await request('/api/exam/history/' + completed.body.history_id, f.other)).status, 404);
});

test('A lost completion response followed by reload and retry preserves order and avoids duplicates', async t => {
    const f = await fixture(t);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    t.after(() => context.close());
    await context.addCookies([{ name: 'sid', value: f.owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    await page.route('**/api/exam?*', route => route.fulfill({ json: [{ id: f.q.id, category_id: 1, question_text: f.q.question_text, options: f.q.options, correct_count: 2 }] }));
    let lost = true;
    await page.route('**/api/exam/check', async route => {
        if (lost) { lost = false; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort(); }
        else await route.continue();
    });
    await page.goto(base);
    await page.locator('#open-exam').click(); await page.locator('#exam-start').click();
    await page.locator('#exam-options label').filter({ has: page.locator('input[value=B]') }).click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('pg16-exam:')))));
    await page.locator('#exam-finish').click(); await page.locator('#error').waitFor({ state: 'visible' });
    await page.reload(); await page.locator('#exam-view').waitFor({ state: 'visible' });
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('pg16-exam:')))));
    assert.equal(restored.submissionId, saved.submissionId);
    assert.deepEqual(restored.questions[0].order, saved.questions[0].order);
    await page.locator('#exam-finish').click(); await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.equal((await query('SELECT count(*)::int AS n FROM exam_history WHERE user_id=$1', [f.owner.id])).rows[0].n, 1);
    assert.equal((await query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1', [f.owner.id])).rows[0].n, 1);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('pg16-exam:'))), false);
    await page.locator('#nav-results').click(); await page.locator('#open-history').click();
    await page.locator('#history-list button').click(); await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#score-errors').textContent(), /Пояснение до изменения/);
});

test('Review failure allows retry and a delayed review cannot replace another section', async t => {
    const f = await fixture(t); await finish(f);
    const context = await browser.newContext(); t.after(() => context.close());
    await context.addCookies([{ name: 'sid', value: f.owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    await page.goto(base + '/#/results'); await page.locator('#open-history').click();
    await page.route('**/api/exam/history/*', route => route.fulfill({ status: 503, json: { error: 'Не удалось загрузить разбор экзамена. Попробуйте ещё раз.' } }));
    await page.locator('#history-list button').click(); await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#history-list button').isEnabled(), true);
    await page.unroute('**/api/exam/history/*');
    let release, arrived;
    const gate = new Promise(r => { release = r; }), reached = new Promise(r => { arrived = r; });
    t.after(release);
    await page.route('**/api/exam/history/*', async route => { arrived(); await gate; await route.continue(); });
    await page.locator('#history-list button').click(); await reached;
    await page.locator('#nav-training').click();
    const response = page.waitForResponse(r => /\/api\/exam\/history\/\d+$/.test(r.url()));
    release(); await response;
    assert.equal(await page.locator('#exam-result-view').isHidden(), true);
    assert.equal(await page.locator('#categories-view').isVisible(), true);
});

test('Rollback failure destroys the connection instead of returning an open transaction to the pool', async () => {
    const { postExamCheck } = require('../src/controllers/quizController');
    const original = pool.connect;
    let released, status;
    pool.connect = async () => ({
        query: async () => { throw Object.assign(new Error(), { code: 'XX000' }); },
        release: broken => { released = broken; },
    });
    const res = { locals: {}, status(code) { status = code; return this; }, json() {} };
    try { await postExamCheck({ user: { id: 1 }, body: { answers: [{ question_id: 1, answer: null }] } }, res); }
    finally { pool.connect = original; }
    assert.equal(status, 500);
    assert.equal(released, true);
    assert.equal(res.locals.errorKind, 'Error/XX000');
});
