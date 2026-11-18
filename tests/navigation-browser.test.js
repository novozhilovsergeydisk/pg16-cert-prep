const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');
let browser, server, base;
async function query(sql, args) {
    try { return await pool.query(sql, args); }
    catch { throw new Error('Navigation fixture query failed'); }
}
before(async () => {
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
    server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await browser?.close(); if (server) await new Promise(r => server.close(r)); await pool.end(); });
async function fixture(t, owner = true, hash = '', setup = async () => {}) {
    const id = (await query("INSERT INTO users(email,role,theme,accent) VALUES($1,'user','dark','graphite') RETURNING id", ['navigation-' + crypto.randomUUID() + '@example.test'])).rows[0].id;
    const token = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest(), id]);
    process.env.AI_ENABLED = '1'; process.env.AI_OWNER_USER_ID = String(owner ? id : 0);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: 'sid', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', () => errors.push(true)); page.setDefaultTimeout(7000);
    t.after(async () => { await context.close(); await query('DELETE FROM users WHERE id=$1', [id]); assert.equal(errors.length, 0); });
    await page.route('**/js/offline.js', route => route.abort());
    await setup(page);
    await page.goto(base + hash); await page.locator('#categories .card').first().waitFor();
    return page;
}
test('Primary navigation supports browser back/forward, direct links and compact profile', async t => {
    const page = await fixture(t);
    await page.waitForURL('**/#/training');
    assert.equal(await page.locator('#ai-home').isVisible(), false);
    assert.equal(await page.locator('#logout').isVisible(), false);
    assert.ok(await page.locator('#categories .card').first().evaluate(n => n.getBoundingClientRect().top < innerHeight));
    await page.locator('#nav-results').click(); await page.waitForURL('**/#/results');
    assert.equal(await page.locator('#nav-results').getAttribute('aria-current'), 'page');
    await page.goBack(); await page.locator('#categories-view').waitFor({ state: 'visible' });
    await page.goForward(); await page.locator('#results-view').waitFor({ state: 'visible' });
    await page.locator('#open-stats').click(); await page.locator('#stats-view').waitFor({ state: 'visible' });
    await page.locator('#nav-results').click(); await page.locator('#results-view').waitFor({ state: 'visible' });
    await page.locator('#user-bar summary').click(); assert.equal(await page.locator('#logout').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#logout').isVisible(), false);
    await page.locator('#nav-ai').click(); await page.locator('#ai-home textarea').waitFor({ state: 'visible' });
    await page.reload(); await page.locator('#ai-home textarea').waitFor({ state: 'visible' });
    assert.match(await page.title(), /ИИ-помощник/);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('#nav-results').click();
        await page.locator('#open-stats').click();
        await page.locator('#stats-view').waitFor({ state: 'visible' });
        await page.locator('#stats-back').click();
        await page.locator('#results-view').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
});
test('General chat keeps draft, messages and in-flight response across section changes', async t => {
    const page = await fixture(t); let release;
    const gate = new Promise(r => { release = r; }); t.after(release);
    await page.route('**/api/ai/conversations', r => r.fulfill({ status: 202, json: { job_id: 'job', conversation_id: 'dialog' } }));
    await page.route('**/api/ai/jobs/*', async r => { await gate; await r.fulfill({ json: { state: 'done', answer: 'Проверенный ответ', turns: 1, max_turns: 6, sources: [] } }); });
    await page.locator('#nav-ai').click(); await page.locator('#ai-home textarea').fill('Первый вопрос');
    await page.locator('#ai-home button[type=submit]').click();
    await page.locator('#nav-results').click(); release();
    await page.locator('#ai-home .ai-message').first().waitFor({ state: 'attached' });
    assert.equal(await page.locator('#results-view').isVisible(), true);
    await page.goBack(); await page.locator('#ai-home textarea').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ai-home .ai-message').count(), 2);
    await page.locator('#ai-home textarea').fill('Неотправленное уточнение');
    await page.locator('#nav-training').click(); await page.locator('#nav-ai').click();
    assert.equal(await page.locator('#ai-home textarea').inputValue(), 'Неотправленное уточнение');
    await page.locator('#ai-home button').filter({ hasText: 'Новый диалог' }).click();
    assert.equal(await page.locator('#ai-home .ai-message').count(), 0);
    await page.locator('#ai-home textarea').fill('Черновик перед выходом');
    await page.locator('#user-bar summary').click();
    await page.locator('#logout').click();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ai-home').textContent(), '');
    assert.equal(await page.locator('#main-nav').isVisible(), false);
});
test('Other account cannot navigate to AI by a direct hash', async t => {
    const page = await fixture(t, false, '#/ai'); await page.waitForURL('**/#/training');
    assert.equal(await page.locator('#nav-ai').isVisible(), false);
    assert.equal(await page.locator('#ai-home').isVisible(), false);
});
test('Exam navigation warns, preserves answers and restores its running deadline', async t => {
    const page = await fixture(t); await page.locator('#open-exam').click();
    await page.locator('#exam-start').click(); await page.locator('#exam-view').waitFor({ state: 'visible' });
    await page.locator('#exam-options .option').first().click();
    const answer = await page.locator('#exam-options input:checked').first().getAttribute('value');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('pg16-exam:')))));
    page.once('dialog', d => d.dismiss()); await page.locator('#nav-results').click();
    assert.equal(await page.locator('#exam-view').isVisible(), true);
    page.once('dialog', d => d.accept()); await page.locator('#nav-results').click();
    await page.locator('#results-view').waitFor({ state: 'visible' });
    await page.locator('#open-exam').click(); await page.locator('#exam-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-options input:checked').first().getAttribute('value'), answer);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('pg16-exam:')))).deadline), saved.deadline);
    await page.reload(); await page.locator('#exam-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-options input:checked').first().getAttribute('value'), answer);
});

test('Late exam setup cannot reopen its section after navigating elsewhere', async t => {
    const page = await fixture(t); let release;
    const gate = new Promise(r => { release = r; }); t.after(release);
    let reached; const arrived = new Promise(r => { reached = r; });
    await page.route('**/api/categories', async r => { reached(); await gate; await r.continue(); }, { times: 1 });
    await page.locator('#open-exam').click(); await arrived;
    await page.locator('#nav-results').click(); await page.locator('#results-view').waitFor({ state: 'visible' });
    release(); await page.waitForTimeout(150);
    assert.equal(await page.locator('#results-view').isVisible(), true);
    assert.match(page.url(), /#\/results$/);
});

test('A delayed AI availability check does not block training or results', async t => {
    let release; const gate = new Promise(r => { release = r; }); t.after(release);
    const page = await fixture(t, true, '', async p => {
        await p.route('**/api/ai/status', async r => { await gate; await r.continue(); });
    });
    assert.equal(await page.locator('#nav-ai').isVisible(), false);
    await page.locator('#nav-results').click(); await page.locator('#results-view').waitFor({ state: 'visible' });
    release(); await page.locator('#nav-ai').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#results-view').isVisible(), true);
});
