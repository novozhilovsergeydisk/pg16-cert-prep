const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

let browser, server, base;
before(async () => {
    const app = express();
    app.get('/', (_req, res) => res.send('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<link rel="stylesheet" href="/css/style.css"><main><div id="panel"></div></main><script src="/js/ai.js"></script>'));
    app.use(express.static('public'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
});
after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
});
async function pageFor(t, handler) {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push(true));
    t.after(() => assert.equal(errors.length, 0));
    page.setDefaultTimeout(5000);
    await page.route('**/api/ai/**', handler);
    await page.goto(base);
    await page.evaluate(async () => {
        const api = async (url, options) => {
            let response;
            try { response = await fetch(url, options); }
            catch (_) { const err = new Error('Связь прервалась. Повторите запрос.'); err.kind = 'network'; throw err; }
            const body = await response.json();
            if (!response.ok) { const err = new Error(body.error); err.kind = 'api'; throw err; }
            return body;
        };
        window.assistant = window.createAiAssistant({ api });
        window.assistant.setUser({ id: 1 });
        await window.assistant.offer(document.querySelector('#panel'), { mode: 'training', batch_id: 1, question_id: 1 });
    });
    return page;
}
const done = (answer, turns = 1) => ({ state: 'done', answer, turns, max_turns: 6,
    sources: [{ title: 'PostgreSQL 16', url: 'https://www.postgresql.org/docs/16/transaction-iso.html' }] });
const reply = (route, json, status = 200) => route.fulfill({ status, json });

test('AI UI shows explanation and dialogue, renders model text safely, and fits a phone', async (t) => {
    let turns = 0;
    const sent = [];
    const page = await pageFor(t, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') {
            sent.push(route.request().postDataJSON()); turns++;
            return reply(route, { job_id: 'job', conversation_id: 'conversation' }, 202);
        }
        return reply(route, done(turns === 1 ? '`SELECT 1` **точно** <img src=x onerror=alert(1)> ' + 'x'.repeat(500) : 'Ответ на уточнение', turns));
    });
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await page.locator('.ai-message').waitFor();
    assert.equal(await page.locator('.ai-message img').count(), 0);
    assert.match(await page.locator('.ai-text').textContent(), /<img/);
    assert.equal(await page.locator('.ai-text code').textContent(), 'SELECT 1');
    assert.equal(await page.locator('.ai-text strong').textContent(), 'точно');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.getByLabel('Уточнение по этому вопросу').fill('Почему?');
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByText('Ответ на уточнение', { exact: true }).waitFor();
    assert.equal(sent[1].message, 'Почему?');
    assert.equal(await page.locator('.ai-message').count(), 3);
});

test('AI UI is absent when the account is not enabled', async (t) => {
    const page = await pageFor(t, (route) => reply(route, { enabled: false }));
    assert.equal(await page.locator('#panel').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Объяснить подробнее' }).count(), 0);
});

test('AI UI ignores a delayed result after changing the question', async (t) => {
    let held;
    const reached = new Promise((resolve) => { held = resolve; });
    let release;
    const page = await pageFor(t, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') return reply(route, { job_id: 'old', conversation_id: 'old' }, 202);
        held();
        await new Promise((resolve) => { release = resolve; });
        return reply(route, done('Ответ на старый вопрос'));
    });
    t.after(() => { if (release) release(); });
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await reached;
    await page.evaluate(async () => {
        window.assistant.reset();
        await window.assistant.offer(document.querySelector('#panel'), { mode: 'training', batch_id: 1, question_id: 2 });
    });
    release();
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Ответ на старый вопрос').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Объяснить подробнее' }).isEnabled(), true);
});

test('AI UI reuses request_id after an uncertain POST and does not duplicate messages', async (t) => {
    const ids = [];
    const page = await pageFor(t, (route) => {
        if (route.request().url().endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') {
            ids.push(route.request().postDataJSON().request_id);
            if (ids.length === 1) return route.abort();
            return reply(route, { job_id: 'job', conversation_id: 'conversation' }, 202);
        }
        return reply(route, done('Один ответ'));
    });
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await page.getByRole('status').filter({ hasText: 'Связь прервалась' }).waitFor();
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await page.getByText('Один ответ', { exact: true }).waitFor();
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
    assert.equal(await page.locator('.ai-message').count(), 1);
});

test('General mode starts immediately, retries safely, and resets the dialogue when switching', async (t) => {
    const sent = [];
    let turns = 0;
    const page = await pageFor(t, (route) => {
        if (route.request().url().endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') {
            sent.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
            if (sent.length === 1) return route.abort();
            turns++;
            return reply(route, { job_id: 'job', conversation_id: 'general-conversation' }, 202);
        }
        return reply(route, { ...done('Ответ ' + turns, turns), sources: [] });
    });
    assert.equal(await page.getByRole('radio', { name: 'По текущему вопросу', exact: true }).isChecked(), true);
    await page.getByRole('radio', { name: 'Любая тема', exact: true }).check();
    await page.getByLabel('Ваш вопрос', { exact: true }).fill('Почему небо голубое?');
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Связь прервалась' }).waitFor();
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByText('Ответ 1', { exact: true }).waitFor();
    assert.equal(sent[0].body.request_id, sent[1].body.request_id);
    assert.equal(sent[1].body.scope, 'general');
    assert.equal(sent[1].body.message, 'Почему небо голубое?');
    assert.equal(await page.locator('.ai-message').count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.getByLabel('Ваш вопрос', { exact: true }).fill('А на закате?');
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByText('Ответ 2', { exact: true }).waitFor();
    assert.match(sent[2].path, /general-conversation\/messages$/);
    await page.getByRole('radio', { name: 'По текущему вопросу', exact: true }).check();
    assert.equal(await page.locator('.ai-message').count(), 0);
    assert.equal(await page.getByLabel('Уточнение по этому вопросу').isVisible(), false);
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await page.getByText('Ответ 3', { exact: true }).waitFor();
    assert.equal(sent[3].path, '/api/ai/conversations');
    assert.equal(sent[3].body.scope, 'question');
    assert.equal(sent[3].body.message, undefined);
    await page.getByRole('radio', { name: 'Любая тема', exact: true }).check();
    assert.equal(await page.locator('.ai-message').count(), 0);
    assert.equal(await page.getByLabel('Ваш вопрос', { exact: true }).inputValue(), '');
});

test('General dialogue can restart after reaching the turn limit without sending an automatic question', async (t) => {
    const sent = [];
    const page = await pageFor(t, (route) => {
        if (route.request().url().endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') {
            sent.push(route.request().postDataJSON());
            return reply(route, { job_id: 'job', conversation_id: 'conversation' }, 202);
        }
        return reply(route, { ...done('Последний ответ', 6), sources: [] });
    });
    await page.getByRole('radio', { name: 'Любая тема', exact: true }).check();
    await page.getByLabel('Ваш вопрос', { exact: true }).fill('Первый вопрос');
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByText('Последний ответ', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Ваш вопрос', { exact: true }).isVisible(), false);
    await page.getByRole('button', { name: 'Новый диалог', exact: true }).click();
    assert.equal(sent.length, 1);
    assert.equal(await page.locator('.ai-message').count(), 0);
    await page.getByLabel('Ваш вопрос', { exact: true }).fill('Новый вопрос');
    await page.getByRole('button', { name: 'Спросить', exact: true }).click();
    await page.getByText('Последний ответ', { exact: true }).waitFor();
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0].request_id, sent[1].request_id);
    assert.equal(sent[1].message, 'Новый вопрос');
});

test('Switching topic ignores an in-flight response and does not disable the new form', async (t) => {
    let release, reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const page = await pageFor(t, async (route) => {
        if (route.request().url().endsWith('/status')) return reply(route, { enabled: true });
        if (route.request().method() === 'POST') {
            reached();
            await new Promise(resolve => { release = resolve; });
            return reply(route, { job_id: 'old', conversation_id: 'old' }, 202);
        }
        return reply(route, done('Старый ответ'));
    });
    t.after(() => { if (release) release(); });
    await page.getByRole('button', { name: 'Объяснить подробнее' }).click();
    await waiting;
    await page.getByRole('radio', { name: 'Любая тема', exact: true }).check();
    release();
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Старый ответ').count(), 0);
    assert.equal(await page.getByLabel('Ваш вопрос', { exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Спросить', exact: true }).isEnabled(), true);
});

test('Full application offers AI only after a saved answer in both modes and survives a missing AI script', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DOTENV_CONFIG_QUIET = 'true';
    const app = require('../server');
    const pool = require('../src/config/db');
    const query = async (sql, params) => {
        try { return await pool.query(sql, params); }
        catch (_) { throw new Error('AI browser fixture query failed'); }
    };
    const oldEnabled = process.env.AI_ENABLED;
    const oldOwner = process.env.AI_OWNER_USER_ID;
    let userId, categoryId, questionId, listener, context;
    const name = 'ИИ: проверка ' + crypto.randomUUID();
    try {
        userId = (await query('INSERT INTO users(email,role) VALUES($1,$2) RETURNING id',
            ['ai-browser-' + crypto.randomUUID() + '@example.test', 'user'])).rows[0].id;
        const sid = crypto.randomBytes(32).toString('base64url');
        await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
            [crypto.createHash('sha256').update(sid).digest(), userId]);
        categoryId = (await query('INSERT INTO categories(name) VALUES($1) RETURNING id', [name])).rows[0].id;
        questionId = (await query(`INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes)
            VALUES($1,'Вопрос ИИ',$2,'A','Проверенное пояснение','{}'::jsonb) RETURNING id`,
        [categoryId, { A: 'Верный', B: 'Неверный' }])).rows[0].id;
        process.env.AI_ENABLED = '1';
        process.env.AI_OWNER_USER_ID = String(userId);
        listener = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => listener.once('listening', resolve));
        const address = 'http://127.0.0.1:' + listener.address().port;
        context = await browser.newContext();
        await context.addCookies([{ name: 'sid', value: sid, url: address, httpOnly: true, sameSite: 'Lax' }]);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const sent = [];
        await page.route('**/api/ai/conversations', (route) => {
            sent.push(route.request().postDataJSON());
            return reply(route, { job_id: 'job', conversation_id: 'conversation' }, 202);
        });
        await page.route('**/api/ai/jobs/*', (route) => reply(route, done('Объяснение на странице')));
        await page.goto(address);
        await page.locator('#categories .card').filter({ hasText: name }).click();
        assert.equal(await page.getByRole('button', { name: 'Объяснить подробнее' }).count(), 0);
        await page.locator('#options .option:has(input[value="A"])').click();
        await page.locator('#submit').click();
        await page.locator('#ai-question > button').click();
        await page.getByText('Объяснение на странице', { exact: true }).waitFor();
        assert.equal(sent[0].mode, 'training');
        assert.equal(sent[0].question_id, questionId);
        assert.ok(Number.isInteger(sent[0].batch_id));
        await page.locator('#back').click();
        await page.locator('#mode-check').click();
        await page.locator('#categories .card').filter({ hasText: name }).click();
        assert.equal(await page.getByRole('button', { name: 'Объяснить подробнее' }).count(), 0);
        await page.locator('#check-yes').click();
        await page.locator('#ai-check > button').click();
        await page.getByText('Объяснение на странице', { exact: true }).waitFor();
        assert.equal(sent[1].mode, 'option-check');
        assert.equal(sent[1].question_id, questionId);
        await page.route('**/js/ai.js', (route) => route.abort());
        await page.reload();
        await page.locator('#categories .card').filter({ hasText: name }).click();
        await page.locator('#options .option:has(input[value="A"])').click();
        await page.locator('#submit').click();
        await page.locator('#result').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#result-status').textContent(), 'Верно');
        assert.equal(await page.getByRole('button', { name: 'Объяснить подробнее' }).count(), 0);
    } finally {
        if (context) await context.close();
        if (listener) await new Promise((resolve) => listener.close(resolve));
        if (userId) await query('DELETE FROM users WHERE id=$1', [userId]);
        if (questionId) await query('DELETE FROM questions WHERE id=$1', [questionId]);
        if (categoryId) await query('DELETE FROM categories WHERE id=$1', [categoryId]);
        if (oldEnabled === undefined) delete process.env.AI_ENABLED; else process.env.AI_ENABLED = oldEnabled;
        if (oldOwner === undefined) delete process.env.AI_OWNER_USER_ID; else process.env.AI_OWNER_USER_ID = oldOwner;
        await pool.end();
    }
});
