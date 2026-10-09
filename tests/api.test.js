const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const app = require('../server');
const pool = require('../src/config/db');

let server;
let base;

before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

async function get(path) {
    const response = await fetch(base + path);
    return { status: response.status, body: await response.json() };
}

async function post(path, payload) {
    const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
}

test('GET /api/test возвращает версию сервера', async () => {
    const { status, body } = await get('/api/test');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.version, 'string');
});

test('GET /api/categories возвращает список с id и name', async () => {
    const { status, body } = await get('/api/categories');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
    assert.deepEqual(Object.keys(body[0]).sort(), ['id', 'name']);
});

test('GET /api/questions не раскрывает правильный ответ и пояснение', async () => {
    const { status, body } = await get('/api/questions?category_id=1');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
    for (const question of body) {
        assert.equal('correct_answer' in question, false);
        assert.equal('explanation' in question, false);
        assert.equal(typeof question.options, 'object');
    }
});

test('GET /api/questions отклоняет некорректный category_id', async () => {
    for (const value of ['', '?category_id=abc', '?category_id=0', '?category_id=-1', '?category_id=99999999999', '?category_id=1.5']) {
        const { status } = await get('/api/questions' + (value.startsWith('?') ? value : ''));
        assert.equal(status, 400, `ожидался 400 для "${value}"`);
    }
});

test('GET /api/questions для несуществующей категории возвращает пустой список', async () => {
    const { status, body } = await get('/api/questions?category_id=2147483647');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
});

test('POST /api/answers: верный ответ', async () => {
    const { status, body } = await post('/api/answers', { question_id: 1, answer: 'C' });
    assert.equal(status, 200);
    assert.equal(body.correct, true);
    assert.equal(body.correct_answer, 'C');
    assert.equal(typeof body.explanation, 'string');
});

test('POST /api/answers: неверный ответ', async () => {
    const { status, body } = await post('/api/answers', { question_id: 1, answer: 'A' });
    assert.equal(status, 200);
    assert.equal(body.correct, false);
    assert.equal(body.correct_answer, 'C');
});

test('POST /api/answers отклоняет некорректные данные', async () => {
    const cases = [
        {},
        { question_id: 1 },
        { answer: 'A' },
        { question_id: 'abc', answer: 'A' },
        { question_id: 1, answer: 'a' },
        { question_id: 1, answer: 'AB' },
        { question_id: 1, answer: 1 },
        { question_id: 99999999999, answer: 'A' },
    ];
    for (const payload of cases) {
        const { status } = await post('/api/answers', payload);
        assert.equal(status, 400, `ожидался 400 для ${JSON.stringify(payload)}`);
    }
});

test('POST /api/answers для несуществующего вопроса возвращает 404', async () => {
    const { status } = await post('/api/answers', { question_id: 2147483647, answer: 'A' });
    assert.equal(status, 404);
});
