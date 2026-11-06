const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { chromium } = require('playwright');
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');
let browser, server, base;
async function query(sql, values) {
    try { return await pool.query(sql, values); }
    catch { throw new Error('Adaptive stats fixture query failed'); }
}
before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); await pool.end(); });
async function newUser() {
    const id = (await query("INSERT INTO users(email,role,theme) VALUES($1,'user','light') RETURNING id", ['adaptive-' + crypto.randomUUID() + '@example.test'])).rows[0].id;
    const token = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest(), id]);
    return { id, token };
}
async function request(path, u, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
        ...(u ? { Cookie: 'sid=' + u.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
}
async function fixture(t, populated = true) {
    const owner = await newUser(), other = await newUser();
    const category = (await query("INSERT INTO categories(name) VALUES('Транзакции и изоляция') RETURNING id")).rows[0].id;
    t.after(async () => {
        await query('DELETE FROM users WHERE id=ANY($1::int[])', [[owner.id, other.id]]);
        await query('DELETE FROM categories WHERE id=$1', [category]);
    });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await query(`INSERT INTO questions(category_id,question_text,options,correct_answer,explanation)
        VALUES($1,$2,$3,'A','Объяснение') RETURNING id`, [category, 'Вопрос об изоляции ' + i,
        JSON.stringify({ A: 'Первый вариант', B: 'Второй вариант', C: 'Третий вариант' })])).rows[0].id);
    async function check(question, key, right, u = owner) {
        const isCorrect = key === 'A';
        const batch = (await query('INSERT INTO option_check_batches(user_id,category_id,category_name,cards) VALUES($1,$2,$3,$4) RETURNING id',
            [u.id, category, 'Транзакции и изоляция', JSON.stringify([{ question_id: question, key, is_correct: isCorrect }])])).rows[0].id;
        const body = { batch_id: batch, question_id: question, fits: right ? isCorrect : !isCorrect };
        assert.equal((await request('/api/option-checks', u, body)).status, 200);
        return body;
    }
    if (populated) {
        await query('INSERT INTO answer_log(user_id,question_id,correct) VALUES($1,$2,false),($1,$2,true),($1,$3,true)', [owner.id, ids[0], ids[1]]);
        await check(ids[0], 'A', false); await check(ids[0], 'B', false); await check(ids[0], 'A', true);
        const repeated = await check(ids[1], 'C', false);
        assert.equal((await request('/api/option-checks', owner, repeated)).status, 200);
        await check(ids[2], 'A', true, other);
    }
    return { owner, other, category, ids, check };
}

test('Separate modes count unique questions, all attempts and latest errors per variant', async t => {
    const f = await fixture(t), response = await request('/api/stats', f.owner);
    assert.equal(response.status, 200);
    const topic = response.body.topics.find(x => x.id === f.category);
    const checks = response.body.option_topics.find(x => x.id === f.category);
    assert.deepEqual([topic.question_count, topic.answered, topic.correct_percent, topic.mistakes], [3, 2, 67, 0]);
    assert.deepEqual([checks.question_count, checks.answered, checks.correct_percent, checks.mistakes], [3, 2, 25, 2]);
    await f.check(f.ids[0], 'B', true);
    const updated = (await request('/api/stats', f.owner)).body;
    assert.deepEqual(updated.topics.find(x => x.id === f.category), topic);
    assert.deepEqual([updated.option_topics.find(x => x.id === f.category).correct_percent, updated.option_topics.find(x => x.id === f.category).mistakes], [40, 1]);
});

test('Both statistics modes remain private and empty accuracy is null instead of zero', async t => {
    const f = await fixture(t);
    const other = (await request('/api/stats', f.other)).body;
    const training = other.topics.find(x => x.id === f.category), checks = other.option_topics.find(x => x.id === f.category);
    assert.deepEqual([training.answered, training.correct_percent, training.mistakes], [0, null, 0]);
    assert.deepEqual([checks.answered, checks.correct_percent, checks.mistakes], [1, 100, 0]);
    assert.equal((await request('/api/stats')).status, 401);
});

async function pageFixture(t, width, theme, populated = true) {
    const f = await fixture(t, populated);
    process.env.AI_ENABLED = '1'; process.env.AI_OWNER_USER_ID = String(f.owner.id);
    await query('UPDATE users SET theme=$1 WHERE id=$2', [theme, f.owner.id]);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    t.after(() => context.close());
    await context.addCookies([{ name: 'sid', value: f.owner.token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', () => errors.push(true));
    t.after(() => assert.equal(errors.length, 0));
    // Скриншоты используют только собственную категорию фикстуры и её реальные агрегаты БД.
    await page.route('**/api/stats', async route => {
        const response = await route.fetch(), data = await response.json();
        data.topics = data.topics.filter(x => x.id === f.category);
        data.option_topics = data.option_topics.filter(x => x.id === f.category);
        await route.fulfill({ response, json: data });
    });
    await page.goto(base); await page.locator('#categories .card').first().waitFor();
    return { ...f, page, context };
}
for (const width of [320, 390, 601, 768, 960, 1280]) for (const theme of ['light', 'dark']) test('Shell, profile and mode statistics at ' + width + 'px, ' + theme, async t => {
    const f = await pageFixture(t, width, theme), p = f.page;
    const brand = await p.locator('.brand').boundingBox(), profile = await p.locator('#user-bar summary').boundingBox();
    assert.ok(Math.abs(brand.y + brand.height / 2 - profile.y - profile.height / 2) < 3);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), width);
    await p.locator('#user-bar summary').click();
    const panel = await p.locator('.profile-panel').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width);
    if (width === 390 || width === 1280) {
        fs.mkdirSync('docs/reviews/2026-11-06-ux-stage3c', { recursive: true });
        await p.screenshot({ path: 'docs/reviews/2026-11-06-ux-stage3c/profile-' + width + '-' + theme + '.png' });
    }
    await p.keyboard.press('Escape'); assert.equal(await p.locator('.profile-panel').isHidden(), true);
    if (width === 390 || width === 1280) {
        fs.mkdirSync('docs/reviews/2026-11-06-ux-stage3c', { recursive: true });
        await p.locator('#categories-view .section-heading h2').click();
        await p.screenshot({ path: 'docs/reviews/2026-11-06-ux-stage3c/home-' + width + '-' + theme + '.png' });
    }
    await p.locator('#nav-results').click(); await p.locator('#open-stats').click();
    await p.locator('#stats-content').waitFor({ state: 'visible' });
    assert.match(await p.locator('#stats-note').textContent(), /включая экзамены/);
    assert.match(await p.locator('#stats-topics').textContent(), /2 из 3.*67%/s);
    assert.equal(await p.locator('#stats-topics progress').getAttribute('value'), '2');
    assert.equal(await p.locator('#stats-topics').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    await p.locator('#stats-checks').focus(); await p.keyboard.press('Enter');
    assert.equal(await p.locator('#stats-checks').getAttribute('aria-pressed'), 'true');
    assert.match(await p.locator('#stats-note').textContent(), /не проверка всех вариантов/);
    assert.match(await p.locator('#stats-topics').textContent(), /2 из 3.*25%/s);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), width);
    assert.equal(await p.locator('.personal-stats').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    if ([320, 390, 1280].includes(width)) {
        const dir = 'docs/reviews/2026-11-06-ux-stage3c'; fs.mkdirSync(dir, { recursive: true });
        await p.locator('#stats-view .section-heading h2').click();
        await p.screenshot({ path: dir + '/stats-' + width + '-' + theme + '.png', fullPage: true });
        if (width !== 320) {
            await p.locator('#nav-results').click();
            await p.screenshot({ path: dir + '/results-' + width + '-' + theme + '.png' });
            await p.locator('#open-exam').click();
            await p.locator('#exam-setup-view').waitFor({ state: 'visible' });
            await p.screenshot({ path: dir + '/exam-' + width + '-' + theme + '.png' });
            await p.locator('#nav-ai').click();
            await p.locator('#ai-home textarea').waitFor({ state: 'visible' });
            await p.screenshot({ path: dir + '/ai-' + width + '-' + theme + '.png' });
            await p.locator('#nav-training').click();
            await p.locator('#categories .card').filter({ hasText: 'Транзакции и изоляция' }).click();
            await p.locator('#question-view').waitFor({ state: 'visible' });
            await p.screenshot({ path: dir + '/question-' + width + '-' + theme + '.png' });
        }
    }
});

test('Empty statistics show a dash instead of zero accuracy', async t => {
    const { page: p } = await pageFixture(t, 390, 'light', false);
    await p.locator('#nav-results').click(); await p.locator('#open-stats').click(); await p.locator('#stats-content').waitFor({ state: 'visible' });
    assert.equal(await p.locator('#stats-empty').isVisible(), true);
    assert.match(await p.locator('#stats-topics').textContent(), /0 из 3.*—/s);
    await p.locator('#stats-checks').click(); assert.match(await p.locator('#stats-empty').textContent(), /не оценивали/);
});

test('Failed statistics load exposes retry; late data cannot replace a different section', async t => {
    const { page: p } = await pageFixture(t, 390, 'light');
    await p.locator('#nav-results').click();
    await p.unroute('**/api/stats');
    await p.route('**/api/stats', route => route.fulfill({ status: 503, json: { error: 'Не удалось загрузить статистику. Попробуйте ещё раз.' } }));
    await p.locator('#open-stats').click(); await p.locator('#stats-retry').waitFor({ state: 'visible' });
    assert.equal(await p.locator('#stats-loading').isHidden(), true);
    await p.unroute('**/api/stats');
    await p.locator('#stats-retry').click(); await p.locator('#stats-content').waitFor({ state: 'visible' });
    await p.locator('#stats-back').click();
    let arrived, release;
    const reached = new Promise(r => { arrived = r; }), gate = new Promise(r => { release = r; }); t.after(release);
    await p.route('**/api/stats', async route => { arrived(); await gate; await route.continue(); });
    await p.locator('#open-stats').click(); await reached;
    assert.equal(await p.locator('#stats-loading').isVisible(), true);
    await p.locator('#nav-training').click();
    const response = p.waitForResponse(r => r.url().endsWith('/api/stats')); release(); await response;
    assert.equal(await p.locator('#categories-view').isVisible(), true);
    assert.equal(await p.locator('#stats-view').isHidden(), true);
    await p.goBack();
    await p.locator('#stats-content').waitFor({ state: 'visible' });
    assert.equal(await p.locator('#stats-loading').isHidden(), true);
});


test('Homepage question counts follow the selected training mode', async t => {
    const f = await pageFixture(t, 390, 'light');
    await f.check(f.ids[2], 'A', true);
    await f.page.reload();
    const card = f.page.locator('#categories .card').filter({ hasText: 'Транзакции и изоляция' });
    await card.waitFor();
    assert.match(await card.textContent(), /Вопросов с ответом: 2 из 3/);
    await f.page.locator('#mode-check').click();
    assert.match(await card.textContent(), /Вопросов с оценкой: 3 из 3/);
    await f.page.locator('#mode-train').click();
    assert.match(await card.textContent(), /Вопросов с ответом: 2 из 3/);
});


test('A delayed earlier category load cannot overwrite the current mode counters', async t => {
    const f = await pageFixture(t, 390, 'light');
    const p = f.page;
    await p.unroute('**/api/stats');
    let arrived, release, calls = 0;
    const reached = new Promise(r => { arrived = r; }), gate = new Promise(r => { release = r; }); t.after(release);
    await p.route('**/api/stats', async route => {
        const response = await route.fetch();
        const data = await response.json();
        if (++calls === 1) { arrived(); await gate; }
        await route.fulfill({ response, json: data });
    });
    await p.locator('#nav-training').click(); await reached;
    await f.check(f.ids[2], 'A', true);
    await p.locator('#nav-results').click(); await p.locator('#nav-training').click();
    const card = p.locator('#categories .card').filter({ hasText: 'Транзакции и изоляция' });
    await card.waitFor();
    const lateResponse = p.waitForResponse(r => r.url().endsWith('/api/stats'));
    release(); await lateResponse;
    await p.locator('#mode-check').click();
    assert.match(await card.textContent(), /Вопросов с оценкой: 3 из 3/);
});
