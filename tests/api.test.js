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

test('GET /api/categories возвращает id, name и число вопросов, отсортировано по имени', async () => {
    const { status, body } = await get('/api/categories');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
    for (const category of body) {
        assert.deepEqual(Object.keys(category).sort(), ['id', 'name', 'question_count']);
        assert.equal(Number.isInteger(category.question_count), true);
    }
    const names = body.map((c) => c.name);
    assert.deepEqual(names, [...names].sort());
});

test('GET /api/questions не раскрывает правильный ответ и пояснение', async () => {
    const { status, body } = await get('/api/questions?category_id=1');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
    for (const question of body) {
        assert.equal('correct_answer' in question, false);
        assert.equal('explanation' in question, false);
        assert.equal(typeof question.options, 'object');
        assert.equal(Number.isInteger(question.correct_count) && question.correct_count >= 1, true);
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
        { question_id: 1, answer: 'AA' },
        { question_id: 1, answer: 'ABCDEFGHI' },
        { question_id: 1, answer: '' },
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

test('GET /api/exam по умолчанию отдаёт 30 уникальных вопросов без ответов', async () => {
    const { status, body } = await get('/api/exam');
    assert.equal(status, 200);
    assert.equal(body.length, 30);
    assert.equal(new Set(body.map((q) => q.id)).size, 30);
    for (const question of body) {
        assert.equal('correct_answer' in question, false);
        assert.equal('explanation' in question, false);
        assert.equal(typeof question.options, 'object');
        assert.equal(Number.isInteger(question.correct_count) && question.correct_count >= 1, true);
    }
});

test('GET /api/exam учитывает count и categories', async () => {
    const five = await get('/api/exam?count=5');
    assert.equal(five.status, 200);
    assert.equal(five.body.length, 5);

    const one = await get('/api/exam?count=200&categories=1');
    assert.equal(one.status, 200);
    assert.ok(one.body.length >= 1);
    assert.ok(one.body.every((q) => q.category_id === 1));

    const none = await get('/api/exam?categories=2147483647');
    assert.equal(none.status, 200);
    assert.deepEqual(none.body, []);
});

test('GET /api/exam отклоняет некорректные параметры', async () => {
    const bad = ['count=0', 'count=abc', 'count=201', 'count=-5', 'categories=', 'categories=a', 'categories=1,x', 'categories=1,,2', 'categories=0'];
    for (const query of bad) {
        const { status } = await get('/api/exam?' + query);
        assert.equal(status, 400, `ожидался 400 для "${query}"`);
    }
});

test('POST /api/exam/check считает результат и порог сдачи', async () => {
    const exam = await get('/api/exam?count=5');
    const answers = [];
    for (const question of exam.body) {
        const probe = await post('/api/answers', { question_id: question.id, answer: 'A' });
        answers.push({ question_id: question.id, answer: probe.body.correct_answer });
    }
    const perfect = await post('/api/exam/check', { answers });
    assert.equal(perfect.status, 200);
    assert.equal(perfect.body.total, 5);
    assert.equal(perfect.body.correct, 5);
    assert.equal(perfect.body.percent, 100);
    assert.equal(perfect.body.passed, true);
    assert.equal(perfect.body.pass_percent, 70);
    assert.equal(perfect.body.results.length, 5);
    assert.ok(perfect.body.results.every((r) => r.correct === true && typeof r.category_id === 'number'));

    const half = await post('/api/exam/check', {
        answers: [
            { question_id: 1, answer: 'C' },
            { question_id: 2, answer: null },
        ],
    });
    assert.equal(half.status, 200);
    assert.equal(half.body.correct, 1);
    assert.equal(half.body.percent, 50);
    assert.equal(half.body.passed, false);
    assert.equal(half.body.results[1].answer, null);
    assert.equal(half.body.results[1].correct, false);
});

test('POST /api/exam/check отклоняет некорректные данные', async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ question_id: i + 1, answer: 'A' }));
    const cases = [
        {},
        { answers: [] },
        { answers: 'x' },
        { answers: [null] },
        { answers: [{ question_id: 1 }] },
        { answers: [{ question_id: 'abc', answer: 'A' }] },
        { answers: [{ question_id: 1, answer: 'a' }] },
        { answers: [{ question_id: 1, answer: 'AA' }] },
        { answers: [{ question_id: 1, answer: '' }] },
        { answers: [{ question_id: 1, answer: 'A' }, { question_id: 1, answer: 'B' }] },
        { answers: tooMany },
    ];
    for (const payload of cases) {
        const { status } = await post('/api/exam/check', payload);
        assert.equal(status, 400, `ожидался 400 для ${JSON.stringify(payload).slice(0, 80)}`);
    }
});

test('POST /api/exam/check для несуществующего вопроса возвращает 404', async () => {
    const { status } = await post('/api/exam/check', { answers: [{ question_id: 2147483647, answer: 'A' }] });
    assert.equal(status, 404);
});

// Временный вопрос с двумя правильными ответами: создаётся перед тестом и удаляется после.
async function withMultiQuestion(fn) {
    const created = await pool.query(
        `INSERT INTO questions (category_id, question_text, options, correct_answer, explanation)
         VALUES (1, 'Тестовый вопрос с двумя ответами', '{"A":"a","B":"b","C":"c","D":"d"}'::jsonb, 'AC', 'тест')
         RETURNING id`
    );
    const id = created.rows[0].id;
    try {
        await fn(id);
    } finally {
        await pool.query('DELETE FROM questions WHERE id = $1', [id]);
    }
}

test('Несколько правильных ответов: correct_count и проверка в тренировке', async () => {
    await withMultiQuestion(async (id) => {
        const list = await get('/api/questions?category_id=1');
        const question = list.body.find((q) => q.id === id);
        assert.equal(question.correct_count, 2);
        assert.equal('correct_answer' in question, false);

        const exact = await post('/api/answers', { question_id: id, answer: 'AC' });
        assert.equal(exact.status, 200);
        assert.equal(exact.body.correct, true);
        assert.equal(exact.body.correct_answer, 'AC');

        const reversed = await post('/api/answers', { question_id: id, answer: 'CA' });
        assert.equal(reversed.body.correct, true);

        for (const partial of ['A', 'C', 'ACD', 'BD']) {
            const r = await post('/api/answers', { question_id: id, answer: partial });
            assert.equal(r.status, 200);
            assert.equal(r.body.correct, false, `ответ ${partial} не должен засчитываться`);
        }
    });
});

test('Несколько правильных ответов: подсчёт в экзамене «всё или ничего»', async () => {
    await withMultiQuestion(async (id) => {
        const r = await post('/api/exam/check', {
            answers: [
                { question_id: id, answer: 'CA' },
                { question_id: 1, answer: 'C' },
            ],
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.correct, 2);
        assert.equal(r.body.results[0].answer, 'AC');
        assert.equal(r.body.results[0].correct_answer, 'AC');

        const partial = await post('/api/exam/check', { answers: [{ question_id: id, answer: 'A' }] });
        assert.equal(partial.body.correct, 0);
        assert.equal(partial.body.percent, 0);
    });
});

test('Ограничение БД не даёт сохранить неверный correct_answer', async () => {
    for (const bad of ['CA', 'AA', 'E', '']) {
        await assert.rejects(
            pool.query('UPDATE questions SET correct_answer = $1 WHERE id = 1', [bad]),
            undefined,
            `значение '${bad}' должно отклоняться`
        );
    }
});
