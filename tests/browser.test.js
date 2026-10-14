const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const app = require('../server');
const pool = require('../src/config/db');

let browser, server, base;
let questions;

// Не включаем реквизиты подключения в диагностический вывод тестов.
async function query(sql, params) {
    try { return await pool.query(sql, params); }
    catch (_) { throw new Error('Не удалось выполнить запрос теста к БД'); }
}

before(async () => {
    questions = (await query('SELECT * FROM questions')).rows;
    browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined });
    server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

async function pageFor(t, width = 390) {
    const email = 'browser-' + crypto.randomBytes(8).toString('hex') + '@example.test';
    const created = await query('INSERT INTO users(email, role) VALUES($1, $2) RETURNING id', [email, 'user']);
    const userId = created.rows[0].id;
    t.after(() => query('DELETE FROM users WHERE id=$1', [userId]));
    const sid = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), userId]);
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: 'light' });
    const errors = [];
    t.after(async () => { await context.close(); assert.equal(errors.length, 0, 'Ошибки JavaScript на странице'); });
    await context.addCookies([{ name: 'sid', value: sid, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', () => errors.push(true));
    page.on('dialog', (dialog) => dialog.accept());
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto(base);
    await page.locator('#categories .card').first().waitFor();
    return { page, userId };
}

async function training(page, id = 4) {
    const q = questions.find((q) => q.id === id);
    assert.ok(q, 'Нужен вопрос из установленного набора миграций');
    await page.route('**/api/training/batches', async (route) => {
        const body = route.request().postDataJSON();
        if (body.category_id !== q.category_id) return route.continue();
        const response = await route.fetch({ postData: { ...body, limit: 200 } });
        const batch = await response.json();
        await route.fulfill({ response, json: { ...batch, questions: batch.questions.filter((item) => item.id === id) } });
    });
    await page.locator('#categories .card').filter({ hasText: '01.' }).click();
    await page.locator('#question-view').waitFor({ state: 'visible' });
    return q;
}

async function choose(page, keys, container = '#options') {
    for (const key of keys) await page.locator(container + ' .option:has(input[value="' + key + '"])').click();
}

test('История порций: браузер показывает сохранённый порядок и связывает ответ с порцией', async (t) => {
    const { page, userId } = await pageFor(t);
    const response = page.waitForResponse((r) => r.url().endsWith('/api/training/batches') && r.request().method() === 'POST');
    await page.locator('#categories .card').filter({ hasText: '01.' }).click();
    const batch = await (await response).json();
    await page.locator('#question-view').waitFor({ state: 'visible' });
    assert.equal(batch.questions.length, 16);
    const stored = (await query('SELECT questions FROM training_batches WHERE id=$1 AND user_id=$2', [batch.id, userId])).rows[0].questions;
    assert.deepEqual(stored.map((q) => q.id), batch.questions.map((q) => q.id));
    const first = stored[0];
    assert.deepEqual(await page.locator('#options input').evaluateAll((inputs) => inputs.map((input) => input.value)), first.order);
    assert.equal(await page.locator('#question-text').textContent(), first.question_text.replace(/```\n?|`/g, '').trim());
    await choose(page, first.correct_answer);
    await page.locator('#submit').click();
    await page.locator('#result').waitFor({ state: 'visible' });
    const answer = (await query('SELECT question_id, selected_answer FROM answer_log WHERE training_batch_id=$1', [batch.id])).rows;
    assert.deepEqual(answer, [{ question_id: first.id, selected_answer: first.correct_answer }]);
    await page.locator('#next').click();
    assert.equal(await page.locator('#question-text').textContent(), stored[1].question_text.replace(/```\n?|`/g, '').trim());
    await back(page);
    await page.locator('#open-training-history').click();
    await page.locator('.training-history-item').first().waitFor();
    await page.locator('.training-history-item').first().click();
    await page.locator('.training-question').first().waitFor();
    assert.equal(await page.locator('.training-question').count(), 16);
    assert.equal(await page.locator('.training-question').first().locator('input:checked').count(), first.correct_answer.length);
    assert.match(await page.locator('.training-question').first().locator('.status').textContent(), /Верно/);
    assert.equal(await page.locator('.training-question').nth(1).locator('.progress').textContent(), 'Без ответа');
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    await page.locator('#training-batch-back').click();
    await page.locator('.training-history-item').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

async function back(page) {
    await page.locator('#back').click();
    await page.locator('#categories .card').first().waitFor();
}

const failure = { status: 503, json: { error: 'Проверочный сбой сети' } };

test('Запоздалая выдача порции не закрывает открытую историю тренировок', async (t) => {
    const { page } = await pageFor(t);
    const held = await holdRequest(t, page, '**/api/training/batches');
    await page.locator('#categories .card').filter({ hasText: '01.' }).click();
    await held.reached;
    await page.locator('#open-training-history').click();
    await page.locator('#training-history-view').waitFor({ state: 'visible' });
    await held.release();
    assert.equal(await page.locator('#training-history-view').isVisible(), true);
    assert.equal(await page.locator('#question-view').isVisible(), false);
});

async function holdRequest(t, page, pattern, response) {
    let release, arrived;
    const gate = new Promise((resolve) => { release = resolve; });
    const reached = new Promise((resolve) => { arrived = resolve; });
    t.after(release);
    await page.route(pattern, async (route) => {
        arrived();
        await gate;
        if (response) await route.fulfill(response);
        else await route.continue();
    }, { times: 1 });
    return { reached, release: async () => {
        const received = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(pattern.replaceAll('*', '')));
        release();
        await (await received).finished();
        // Даём обработчику fetch применить (либо отклонить) уже полученный ответ.
        await page.waitForTimeout(100);
    } };
}

test('Тренировка: повторная отправка создаёт одну запись и один набор пояснений', async (t) => {
    const { page, userId } = await pageFor(t);
    const q = await training(page, 264);
    await choose(page, q.correct_answer);
    const held = await holdRequest(t, page, '**/api/answers');
    let requests = 0;
    page.on('request', (r) => { if (r.url().endsWith('/api/answers')) requests++; });
    await page.locator('#submit').dblclick({ delay: 50 });
    // Проверяем также повторную отправку формы с клавиатуры/через requestSubmit.
    await page.locator('#answer-form').evaluate((form) => form.requestSubmit());
    await held.reached;
    assert.equal(await page.locator('#submit').isDisabled(), true);
    assert.equal(await page.locator('#options input:enabled').count(), 0);
    await held.release();
    await page.locator('#result').waitFor({ state: 'visible' });
    assert.equal(requests, 1);
    assert.equal((await query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1', [userId])).rows[0].n, 1);
    assert.equal(await page.locator('#options .option-note').count(), Object.keys(q.options).length);
    assert.equal(await page.locator('#result-status').textContent(), 'Верно');
});

test('Тренировка: после отказа API можно исправить выбор и повторить ответ', async (t) => {
    const { page } = await pageFor(t);
    const q = await training(page);
    await choose(page, 'B');
    await page.route('**/api/answers', (route) => route.fulfill(failure), { times: 1 });
    await page.locator('#submit').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#submit').isEnabled(), true);
    assert.equal(await page.locator('#options input:disabled').count(), 0);
    await choose(page, q.correct_answer);
    await page.locator('#submit').click();
    await page.locator('#result').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#result-status').textContent(), 'Верно');
    assert.equal(await page.locator('#error').isVisible(), false);
});

for (const scenario of ['другая тема', 'тот же вопрос', 'ошибка старого запроса']) {
    test('Тренировка: запоздалый ответ не меняет новый экран — ' + scenario, async (t) => {
        const { page } = await pageFor(t);
        const q = await training(page);
        await choose(page, q.correct_answer);
        const held = await holdRequest(t, page, '**/api/answers', scenario.includes('ошибка') ? failure : undefined);
        await page.locator('#submit').click();
        await held.reached;
        await back(page);
        if (scenario === 'тот же вопрос') {
            await page.locator('#categories .card').filter({ hasText: '01.' }).click();
        } else {
            await page.locator('#categories .card').filter({ hasText: '02.' }).click();
        }
        await page.locator('#question-view').waitFor({ state: 'visible' });
        await held.release();
        assert.equal(await page.locator('#result').isVisible(), false);
        assert.equal(await page.locator('#error').isVisible(), false);
        assert.equal(await page.locator('#submit').isEnabled(), true);
        assert.equal(await page.locator('#options .option-note').count(), 0);
        assert.equal(await page.locator('#options input:checked').count(), 0);
    });
}

async function startExam(page) {
    await page.locator('#open-exam').click();
    await page.locator('#exam-count .chip').filter({ hasText: '20' }).click();
    await page.locator('#exam-start').click();
    await page.locator('#exam-view').waitFor({ state: 'visible' });
}

async function savedExam(page) {
    return page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('pg16-exam:'));
        return key ? JSON.parse(localStorage.getItem(key)) : null;
    });
}

test('Экзамен: после отказа до срока таймер продолжает идти и автоматически завершает экзамен', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    const original = await savedExam(page);
    await page.route('**/api/exam/check', (route) => route.fulfill(failure), { times: 1 });
    await page.locator('#exam-finish').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-options input:disabled').count(), 0);
    await page.clock.fastForward(5000);
    assert.equal(await page.locator('#exam-timer').textContent(), '29:55');
    assert.equal((await savedExam(page)).deadline, original.deadline);
    await page.clock.fastForward('30:00');
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.equal(await savedExam(page), null);
    assert.equal(await page.locator('#error').isVisible(), false);
});

test('Экзамен: отказ после срока блокирует ответы без цикла запросов; ручной повтор работает', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    await page.locator('#exam-options .option').first().click();
    const original = await savedExam(page);
    let attempts = 0;
    await page.route('**/api/exam/check', (route) => { attempts++; return route.fulfill(failure); });
    await page.clock.fastForward('30:01');
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-timer').textContent(), '00:00');
    assert.equal(await page.locator('#exam-options input:enabled').count(), 0);
    assert.equal(await page.locator('#exam-finish').isEnabled(), true);
    // Даже искусственное событие change после срока не меняет сохранённые ответы.
    await page.locator('#exam-options input').last().evaluate((input) => {
        input.checked = true; input.dispatchEvent(new Event('change'));
    });
    assert.deepEqual((await savedExam(page)).answers, original.answers);
    await page.locator('#exam-next').click();
    assert.equal(await page.locator('#exam-options input:enabled').count(), 0);
    await page.clock.fastForward('01:00');
    assert.equal(attempts, 1);
    await page.unroute('**/api/exam/check');
    await page.locator('#exam-finish').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.equal(await savedExam(page), null);
});

test('Экзамен: срок истекает во время отправки, отказ сохраняет блокировку и ответы', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    const original = await savedExam(page);
    const held = await holdRequest(t, page, '**/api/exam/check', failure);
    await page.locator('#exam-finish').click();
    await held.reached;
    assert.equal(await page.locator('#exam-options input:enabled').count(), 0);
    assert.equal(await page.locator('#exam-finish').isDisabled(), true);
    await page.clock.fastForward('30:01');
    await held.release();
    assert.equal(await page.locator('#exam-timer').textContent(), '00:00');
    assert.equal(await page.locator('#exam-options input:enabled').count(), 0);
    assert.deepEqual(await savedExam(page), original);
    assert.equal(await page.locator('#exam-finish').isEnabled(), true);
});

test('Экзамен: просроченная сохранённая попытка после отказа открывается для повторного завершения', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('pg16-exam:'));
        const data = JSON.parse(localStorage.getItem(key));
        data.deadline = Date.now() - 1;
        localStorage.setItem(key, JSON.stringify(data));
    });
    await page.route('**/api/exam/check', (route) => route.fulfill(failure), { times: 1 });
    await page.reload();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-view').isVisible(), true);
    assert.equal(await page.locator('#exam-options input:enabled').count(), 0);
    await page.locator('#exam-finish').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
});

test('Экзамен: сохранение и продолжение сохраняют позицию и выбранный ответ', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    await page.locator('#exam-options .option').first().click();
    const firstAnswer = (await savedExam(page)).answers[0];
    await page.locator('#exam-next').click();
    await page.reload();
    await page.locator('#exam-resume-continue').click();
    assert.equal(await page.locator('#exam-progress').textContent(), 'Вопрос 2 из 20');
    await page.locator('#exam-prev').click();
    assert.equal(await page.locator('#exam-options input:checked').getAttribute('value'), firstAnswer);
    await page.locator('#exam-finish').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
    assert.equal(await savedExam(page), null);
});

test('Экзамен: отказ при завершении сохранённой попытки с главного экрана допускает повтор', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    await page.reload();
    await page.route('**/api/exam/check', (route) => route.fulfill(failure), { times: 1 });
    await page.locator('#exam-resume-finish').click();
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#exam-view').isVisible(), true);
    await page.clock.fastForward(5000);
    assert.equal(await page.locator('#exam-timer').textContent(), '29:55');
    await page.locator('#exam-finish').click();
    await page.locator('#exam-result-view').waitFor({ state: 'visible' });
});

test('Экзамен: истёкшая авторизация показывает вход без ошибки JavaScript', async (t) => {
    const { page } = await pageFor(t);
    await startExam(page);
    await page.route('**/api/exam/check', (route) => route.fulfill({ status: 401, json: {} }));
    await page.locator('#exam-finish').click();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    await page.clock.fastForward('31:00');
    assert.equal(await page.locator('#exam-view').isVisible(), false);
});

test('Карточки категорий помещаются на ширинах 320, 360, 390 и 1280 px', async (t) => {
    const { page } = await pageFor(t);
    for (const width of [320, 360, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            maxRight: Math.max(...[...document.querySelectorAll('.card')].map((el) => el.getBoundingClientRect().right)),
        }));
        assert.ok(bounds.width <= width && bounds.maxRight <= width, 'Переполнение при ширине ' + width);
    }
});

for (const id of [264, 268]) {
    test('Вопрос ' + id + ': формат, пояснения и ширина 320 px', async (t) => {
        const { page } = await pageFor(t, 320);
        const q = await training(page, id);
        await choose(page, q.correct_answer);
        await page.locator('#submit').click();
        await page.locator('#result').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#result-status').textContent(), 'Верно');
        assert.equal(await page.locator('#options .option-note').count(), 4);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    });
}
