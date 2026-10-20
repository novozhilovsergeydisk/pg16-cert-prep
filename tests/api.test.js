const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
// Письма в тестах не отправляются, а складываются в outbox.
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const { outbox } = require('../src/services/mailer');

const TEST_DOMAIN = '@example.test';
let server;
let base;
let userA;
let cookieA;

test('Основы объектов: новые вопросы доступны в пуле, пятый вариант и ключи проверяются полностью', async () => {
    const texts = require('../scripts/questions/030_database_object_basics').questions.map((q) => q.q);
    const added = (await pool.query('SELECT * FROM questions WHERE question_text=ANY($1::text[])', [texts])).rows;
    assert.equal(added.length, 30, 'Нужна миграция 030');
    const user = await createUser();
    for (const category of [...new Set(added.map((q) => q.category_id))]) {
        const response = await post('/api/training/batches', { category_id: category, limit: 200 }, user.cookie);
        assert.equal(response.status, 201);
        const batch = response.body;
        for (const q of added.filter((q) => q.category_id === category)) {
            const shown = batch.questions.find((item) => item.id === q.id);
            assert.ok(shown);
            assert.deepEqual(shown.options, q.options);
            assert.equal(shown.correct_count, q.correct_answer.length);
            assert.deepEqual([...shown.order].sort(), Object.keys(q.options).sort());
            for (const key of ['correct_answer', 'option_notes', 'explanation']) assert.ok(!(key in shown));
            const answer = await post('/api/answers', { question_id: q.id, training_batch_id: batch.id, answer: q.correct_answer }, user.cookie);
            assert.equal(answer.status, 200);
            assert.equal(answer.body.correct, true);
            assert.deepEqual(answer.body.option_notes, q.option_notes);
        }
        const portion = await post('/api/training/batches', { category_id: category }, user.cookie);
        assert.equal(portion.body.questions.length, 16);
        assert.equal(new Set(portion.body.questions.map((q) => q.id)).size, 16);
        assert.equal(new Set(portion.body.questions.map((q) => q.question_text.trim().replace(/\s+/g, ' '))).size, 16);
    }
    const multi = added.find((q) => Object.keys(q.options).length === 5 && q.correct_answer.includes('E') && q.correct_answer.length > 1);
    assert.ok(multi, 'Нужен множественный ответ, включающий пятый вариант');
    const incomplete = await post('/api/exam/check', { answers: [{ question_id: multi.id, answer: multi.correct_answer.replace('E', '') }] }, user.cookie);
    assert.equal(incomplete.status, 200);
    assert.equal(incomplete.body.correct, 0);
    const complete = await post('/api/exam/check', { answers: added.map((q) => ({ question_id: q.id, answer: q.correct_answer })) }, user.cookie);
    assert.equal(complete.status, 200);
    assert.equal(complete.body.correct, 30);
});

test('История тренировок: сохраняет все 16 вопросов и порядок, не раскрывает ответы', async () => {
    const user = await createUser();
    const { status, body } = await post('/api/training/batches', { category_id: 1 }, user.cookie);
    assert.equal(status, 201);
    assert.equal(body.questions.length, 16);
    assert.equal(new Set(body.questions.map((q) => q.id)).size, 16);
    const stored = (await pool.query('SELECT * FROM training_batches WHERE id=$1', [body.id])).rows[0];
    assert.equal(stored.user_id, user.id);
    assert.deepEqual(stored.questions.map((q) => q.id), body.questions.map((q) => q.id));
    for (let i = 0; i < body.questions.length; i++) {
        const q = body.questions[i];
        assert.equal(q.question_text, stored.questions[i].question_text);
        assert.deepEqual(q.order, stored.questions[i].order);
        assert.deepEqual([...q.order].sort(), Object.keys(q.options).sort());
        for (const key of ['correct_answer', 'explanation', 'option_notes']) assert.equal(key in q, false);
    }
    const history = await get('/api/training/batches/' + body.id, user.cookie);
    assert.equal(history.status, 200);
    assert.equal(history.body.questions.length, 16);
    assert.equal(history.body.questions.every((q) => q.answer === null && !('correct_answer' in q)), true);
});

test('История тренировок: повтор одного ответа не дублирует статистику, другой ответ отклоняется', async () => {
    const user = await createUser();
    const batch = (await post('/api/training/batches', { category_id: 1 }, user.cookie)).body;
    const q = batch.questions[0];
    const correct = (await pool.query('SELECT correct_answer FROM questions WHERE id=$1', [q.id])).rows[0].correct_answer;
    const payload = { training_batch_id: batch.id, question_id: q.id, answer: correct };
    const results = await Promise.all([post('/api/answers', payload, user.cookie), post('/api/answers', payload, user.cookie)]);
    assert.equal(results.every((r) => r.status === 200 && r.body.correct), true);
    const logged = (await pool.query('SELECT * FROM answer_log WHERE training_batch_id=$1', [batch.id])).rows;
    assert.equal(logged.length, 1);
    assert.equal(logged[0].selected_answer, correct);
    const other = Object.keys(q.options).find((k) => k !== correct);
    assert.equal((await post('/api/answers', { ...payload, answer: other }, user.cookie)).status, 409);
    const history = (await get('/api/training/batches/' + batch.id, user.cookie)).body;
    assert.equal(history.questions[0].answer.correct, true);
    assert.equal(history.questions[0].answer.selected_answer, correct);
    assert.equal(history.questions[0].position, 1);
    assert.equal(history.questions[1].answer, null);
});

test('История тренировок: чужая порция недоступна для чтения и записи', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const batch = (await post('/api/training/batches', { category_id: 1 }, owner.cookie)).body;
    assert.equal((await get('/api/training/batches/' + batch.id, stranger.cookie)).status, 404);
    assert.equal((await post('/api/answers', { training_batch_id: batch.id, question_id: batch.questions[0].id, answer: 'A' }, stranger.cookie)).status, 404);
    assert.equal((await get('/api/training/batches', stranger.cookie)).body.batches.length, 0);
    assert.equal((await get('/api/training/batches', null)).status, 401);
    assert.equal((await post('/api/training/batches', { category_id: 1 }, null)).status, 401);
});

test('История тренировок: неверные параметры и вопрос вне порции отклоняются', async () => {
    const user = await createUser();
    for (const body of [{}, { category_id: 0 }, { category_id: 1, limit: 0 }, { category_id: 1, limit: 201 }, { mode: 'exam' }]) {
        assert.equal((await post('/api/training/batches', body, user.cookie)).status, 400);
    }
    assert.equal((await post('/api/training/batches', { category_id: 2147483647 }, user.cookie)).status, 404);
    const batch = (await post('/api/training/batches', { category_id: 1, limit: 1 }, user.cookie)).body;
    const other = (await pool.query('SELECT id FROM questions WHERE id<>$1 LIMIT 1', [batch.questions[0].id])).rows[0].id;
    assert.equal((await post('/api/answers', { training_batch_id: batch.id, question_id: other, answer: 'A' }, user.cookie)).status, 400);
    assert.equal((await get('/api/training/batches?before=bad', user.cookie)).status, 400);
    assert.equal((await get('/api/training/batches/bad', user.cookie)).status, 400);
});

test('История тренировок: снимок и проверка ответа сохраняются после редактирования вопроса', async () => {
    const user = await createUser();
    const category = (await pool.query('INSERT INTO categories(name) VALUES($1) RETURNING id', ['Тест истории ' + user.id])).rows[0].id;
    try {
        const q = (await pool.query(`INSERT INTO questions(category_id, question_text, options, correct_answer, explanation)
            VALUES($1, 'Исходный вопрос', '{"A":"Первый","B":"Второй"}'::jsonb, 'A', 'Исходное пояснение') RETURNING id`, [category])).rows[0].id;
        const batch = (await post('/api/training/batches', { category_id: category }, user.cookie)).body;
        await pool.query("UPDATE questions SET question_text='Изменённый вопрос', correct_answer='B' WHERE id=$1", [q]);
        const history = (await get('/api/training/batches/' + batch.id, user.cookie)).body;
        assert.equal(history.questions[0].question_text, 'Исходный вопрос');
        const result = await post('/api/answers', { training_batch_id: batch.id, question_id: q, answer: 'A' }, user.cookie);
        assert.equal(result.body.correct, true);
        assert.equal(result.body.explanation, 'Исходное пояснение');
    } finally {
        await pool.query('DELETE FROM categories WHERE id=$1', [category]);
    }
});

test('История тренировок: работа над ошибками сохраняется отдельно от порций раздела', async () => {
    const user = await createUser();
    const empty = await post('/api/training/batches', { mode: 'mistakes' }, user.cookie);
    assert.equal(empty.body.id, null);
    await pool.query('INSERT INTO answer_log(user_id, question_id, correct) VALUES($1, 1, false)', [user.id]);
    const batch = (await post('/api/training/batches', { mode: 'mistakes' }, user.cookie)).body;
    assert.deepEqual(batch.questions.map((q) => q.id), [1]);
    const list = (await get('/api/training/batches', user.cookie)).body;
    assert.equal(list.batches.length, 1);
    assert.equal(list.batches[0].mode, 'mistakes');
    assert.equal(list.batches[0].category_id, null);
});

test('История тренировок: страницы истории не теряют и не повторяют порции', async () => {
    const user = await createUser();
    await pool.query(`INSERT INTO training_batches(user_id, category_name, mode, questions)
        SELECT $1, 'Тест', 'mistakes', '[{"id":1}]'::jsonb FROM generate_series(1, 51)`, [user.id]);
    const first = (await get('/api/training/batches', user.cookie)).body;
    assert.equal(first.batches.length, 50);
    const second = (await get('/api/training/batches?before=' + first.next_before, user.cookie)).body;
    assert.equal(second.batches.length, 1);
    assert.equal(second.next_before, null);
    assert.equal(new Set([...first.batches, ...second.batches].map((b) => b.id)).size, 51);
});

// Тестовые пользователи создаются напрямую в базе; после тестов они удаляются вместе с ответами и экзаменами.
async function createUser(role = 'user') {
    const email = 'test-' + crypto.randomBytes(6).toString('hex') + TEST_DOMAIN;
    const created = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, role]);
    const sid = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), created.rows[0].id]
    );
    return { id: created.rows[0].id, email, cookie: 'sid=' + sid };
}

before(async () => {
    userA = await createUser();
    cookieA = userA.cookie;
    await new Promise((resolve) => {
        server = app.listen(0, resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE 'test-%' || $1", [TEST_DOMAIN]);
    await pool.query("DELETE FROM login_tokens WHERE email LIKE 'test-%' || $1", [TEST_DOMAIN]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
});

async function get(path, cookie = cookieA) {
    const response = await fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: response.status, body: await response.json() };
}

async function post(path, payload, cookie = cookieA, extraHeaders = {}) {
    const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
}

test('GET /api/test возвращает версию сервера', async () => {
    const { status, body } = await get('/api/test');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.version, 'string');
});

test('GET /api/categories возвращает id, name, in_exam и число вопросов, отсортировано по имени', async () => {
    const { status, body } = await get('/api/categories');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 1);
    for (const category of body) {
        assert.deepEqual(Object.keys(category).sort(), ['id', 'in_exam', 'name', 'question_count']);
        assert.equal(typeof category.in_exam, 'boolean');
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
    // Отдельный пользователь: перебор в цикле не должен расходовать лимит проверок основного.
    const user = await createUser();
    for (const payload of cases) {
        const { status } = await post('/api/exam/check', payload, user.cookie);
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

test('Работа над ошибками: неверный ответ добавляет вопрос в список, верный убирает', async () => {
    await post('/api/answers', { question_id: 1, answer: 'A' });
    const after = await get('/api/mistakes');
    assert.equal(after.status, 200);
    const item = after.body.find((q) => q.id === 1);
    assert.ok(item, 'вопрос 1 должен попасть в список ошибок');
    assert.deepEqual(Object.keys(item).sort(), ['category_id', 'correct_count', 'id', 'options', 'question_text']);
    assert.equal('correct_answer' in item, false);
    assert.equal('explanation' in item, false);

    await post('/api/answers', { question_id: 1, answer: 'C' });
    const fixed = await get('/api/mistakes');
    assert.equal(fixed.body.some((q) => q.id === 1), false, 'после верного ответа вопрос уходит из списка');
});

test('Работа над ошибками: экзамен записывает только отвеченные вопросы', async () => {
    const count = async (id) => Number((await pool.query('SELECT count(*) AS n FROM answer_log WHERE user_id = $1 AND question_id = $2', [userA.id, id])).rows[0].n);
    const before1 = await count(1);
    const before2 = await count(2);
    const r = await post('/api/exam/check', {
        answers: [
            { question_id: 1, answer: 'A' },
            { question_id: 2, answer: null },
        ],
    });
    assert.equal(r.status, 200);
    assert.equal(await count(1), before1 + 1);
    assert.equal(await count(2), before2, 'вопрос без ответа в журнал не пишется');
    const list = await get('/api/mistakes');
    assert.ok(list.body.some((q) => q.id === 1));
    assert.equal(list.body.some((q) => q.id === 2 && before2 === 0), false);
});

test('История экзаменов: проверка экзамена сохраняет результат и длительность', async () => {
    const mark = Number((await pool.query('SELECT coalesce(max(id), 0) AS id FROM exam_history')).rows[0].id);
    const r = await post('/api/exam/check', {
        answers: [
            { question_id: 1, answer: 'C' },
            { question_id: 2, answer: null },
        ],
        duration_seconds: 125,
    });
    assert.equal(r.status, 200);
    const saved = await pool.query('SELECT * FROM exam_history WHERE id > $1 AND user_id = $2 ORDER BY id', [mark, userA.id]);
    assert.equal(saved.rowCount, 1);
    const row = saved.rows[0];
    assert.equal(row.total, 2);
    assert.equal(row.correct, 1);
    assert.equal(row.percent, 50);
    assert.equal(row.passed, false);
    assert.equal(row.duration_seconds, 125);

    const noDuration = await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }] });
    assert.equal(noDuration.status, 200);
    const last = await pool.query('SELECT duration_seconds, passed FROM exam_history WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userA.id]);
    assert.equal(last.rows[0].duration_seconds, null);
    assert.equal(last.rows[0].passed, true);
});

test('История экзаменов: некорректная длительность отклоняется и ничего не сохраняет', async () => {
    const before = Number((await pool.query('SELECT count(*) AS n FROM exam_history')).rows[0].n);
    const user = await createUser();
    for (const bad of [-1, 1.5, '10', 999999, true]) {
        const { status } = await post('/api/exam/check', {
            answers: [{ question_id: 1, answer: 'C' }],
            duration_seconds: bad,
        }, user.cookie);
        assert.equal(status, 400, `ожидался 400 для duration_seconds=${JSON.stringify(bad)}`);
    }
    const after = Number((await pool.query('SELECT count(*) AS n FROM exam_history')).rows[0].n);
    assert.equal(after, before);
});

test('GET /api/exam/history отдаёт экзамены, новые сверху, не больше 50', async () => {
    await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }], duration_seconds: 1 });
    await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'A' }], duration_seconds: 2 });
    const { status, body } = await get('/api/exam/history');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 2 && body.length <= 50);
    assert.deepEqual(Object.keys(body[0]).sort(), ['correct', 'duration_seconds', 'finished_at', 'id', 'passed', 'percent', 'total']);
    assert.equal(body[0].duration_seconds, 2);
    assert.equal(body[0].passed, false);
    const times = body.map((e) => new Date(e.finished_at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('GET /api/questions с limit отдаёт порцию без ответов и пояснений', async () => {
    const { status, body } = await get('/api/questions?category_id=1&limit=5');
    assert.equal(status, 200);
    assert.equal(body.length, 5);
    assert.equal(new Set(body.map((q) => q.id)).size, 5);
    for (const q of body) {
        assert.equal(q.category_id, 1);
        assert.equal('correct_answer' in q, false);
        assert.equal('explanation' in q, false);
        assert.equal('option_notes' in q, false);
    }
    for (const bad of ['0', 'abc', '201', '-1', '1.5']) {
        const r = await get('/api/questions?category_id=1&limit=' + bad);
        assert.equal(r.status, 400, `ожидался 400 для limit=${bad}`);
    }
});

test('Умный выбор: сначала невиденные, затем с неверным последним ответом', async () => {
    const ids = (await pool.query('SELECT id FROM questions WHERE category_id = 1 ORDER BY id')).rows.map((r) => r.id);
    // все вопросы темы «отвечены верно», один — неверно последним
    await pool.query('INSERT INTO answer_log (user_id, question_id, correct) SELECT $1, unnest($2::int[]), true', [userA.id, ids]);
    const wrongId = ids[Math.floor(ids.length / 2)];
    await pool.query('INSERT INTO answer_log (user_id, question_id, correct) VALUES ($1, $2, false)', [userA.id, wrongId]);
    const first = await get('/api/questions?category_id=1&limit=1');
    assert.equal(first.body[0].id, wrongId, 'вопрос с неверным последним ответом идёт первым');

    // невиденный вопрос идёт раньше ошибочного
    const created = await pool.query(
        `INSERT INTO questions (category_id, question_text, options, correct_answer, explanation)
         VALUES (1, 'Тестовый невиденный вопрос', '{"A":"a","B":"b","C":"c","D":"d"}'::jsonb, 'A', 'тест')
         RETURNING id`
    );
    const unseenId = created.rows[0].id;
    try {
        const top = await get('/api/questions?category_id=1&limit=2');
        assert.deepEqual(top.body.map((q) => q.id), [unseenId, wrongId]);
    } finally {
        await pool.query('DELETE FROM questions WHERE id = $1', [unseenId]);
    }
});

test('Пояснения к вариантам отдаются только после ответа', async () => {
    const notes = { A: 'верный: пояснение A', B: 'неверный: пояснение B', C: 'неверный: пояснение C', D: 'неверный: пояснение D' };
    const created = await pool.query(
        `INSERT INTO questions (category_id, question_text, options, correct_answer, explanation, option_notes)
         VALUES (1, 'Тестовый вопрос с пояснениями', '{"A":"a","B":"b","C":"c","D":"d"}'::jsonb, 'A', 'тест', $1::jsonb)
         RETURNING id`,
        [JSON.stringify(notes)]
    );
    const id = created.rows[0].id;
    try {
        const all = await get('/api/questions?category_id=1');
        assert.equal('option_notes' in all.body.find((q) => q.id === id), false);
        const answer = await post('/api/answers', { question_id: id, answer: 'B' });
        assert.deepEqual(answer.body.option_notes, notes);
        const exam = await post('/api/exam/check', { answers: [{ question_id: id, answer: 'C' }] });
        assert.deepEqual(exam.body.results[0].option_notes, notes);
        // Вопрос без пояснений (временный): пояснений в ответе нет.
        const bare = await pool.query(
            `INSERT INTO questions (category_id, question_text, options, correct_answer, explanation)
             VALUES (1, 'Тестовый вопрос без пояснений', '{"A":"a","B":"b","C":"c","D":"d"}'::jsonb, 'A', 'тест')
             RETURNING id`
        );
        try {
            const plain = await post('/api/answers', { question_id: bare.rows[0].id, answer: 'C' });
            assert.equal(plain.body.option_notes, null);
        } finally {
            await pool.query('DELETE FROM questions WHERE id = $1', [bare.rows[0].id]);
        }
    } finally {
        await pool.query('DELETE FROM questions WHERE id = $1', [id]);
    }
});

// Вход по ссылке, роли и статистика

function tokenFromMail(mail) {
    const match = /#login=([A-Za-z0-9_-]{43})/.exec(mail.text);
    assert.ok(match, 'в письме должна быть ссылка для входа');
    return match[1];
}

function sidFrom(headers) {
    const match = /(?:^|,\s*)sid=([A-Za-z0-9_-]{43});/.exec(headers.get('set-cookie') || '');
    return match ? 'sid=' + match[1] : null;
}

test('Без входа API тренажёра и статистики недоступно', async () => {
    for (const path of ['/api/me', '/api/categories', '/api/questions?category_id=1', '/api/mistakes', '/api/exam', '/api/exam/history', '/api/stats', '/api/admin/users']) {
        const { status } = await get(path, null);
        assert.equal(status, 401, `ожидался 401 для ${path}`);
    }
    const answer = await post('/api/answers', { question_id: 1, answer: 'C' }, null);
    assert.equal(answer.status, 401);
    const bogus = await get('/api/categories', 'sid=' + 'x'.repeat(43));
    assert.equal(bogus.status, 401);
});

test('Вход по ссылке: письмо, одноразовый токен, сеанс, выход', async () => {
    const email = 'test-' + crypto.randomBytes(6).toString('hex') + TEST_DOMAIN;
    const sent = outbox.length;
    const request = await post('/api/auth/request', { email: '  ' + email.toUpperCase() + ' ' }, null);
    assert.equal(request.status, 200);
    assert.equal(request.body.ok, true);
    assert.match(request.body.request_id, /^[A-Za-z0-9_-]{43}$/, 'странице возвращается номер запроса');
    assert.equal(outbox.length, sent + 1);
    const mail = outbox[outbox.length - 1];
    assert.equal(mail.to, email);
    assert.match(mail.subject, /^Вход на /);
    assert.match(mail.text, /^Ссылка для входа действует 15 минут: http/);
    const stored = await pool.query('SELECT count(*)::int AS n FROM login_tokens WHERE email = $1 AND token_hash = $2', [email, crypto.createHash('sha256').update(tokenFromMail(mail)).digest()]);
    assert.equal(stored.rows[0].n, 1, 'в базе хранится хеш токена');

    const verify = await post('/api/auth/verify', { token: tokenFromMail(mail) }, null);
    assert.equal(verify.status, 200);
    assert.deepEqual(verify.body, { email, role: 'user' });
    const cookie = sidFrom(verify.headers);
    assert.ok(cookie, 'ставится cookie сеанса');
    assert.match(verify.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(verify.headers.get('set-cookie'), /SameSite=Lax/i);

    const me = await get('/api/me', cookie);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { email, role: 'user' });

    const again = await post('/api/auth/verify', { token: tokenFromMail(mail) }, null);
    assert.equal(again.status, 400, 'токен одноразовый');

    const out = await post('/api/auth/logout', {}, cookie);
    assert.equal(out.status, 200);
    assert.equal((await get('/api/me', cookie)).status, 401, 'после выхода сеанс недействителен');
});

test('Вход по ссылке: некорректный email, частые запросы, просроченный и неверный токен', async () => {
    for (const bad of ['', 'abc', 'a@b', 'a b@c.ru', 'x'.repeat(250) + '@a.ru', null, 5]) {
        const { status } = await post('/api/auth/request', { email: bad }, null);
        assert.equal(status, 400, `ожидался 400 для ${JSON.stringify(bad)}`);
    }
    const email = 'test-' + crypto.randomBytes(6).toString('hex') + TEST_DOMAIN;
    assert.equal((await post('/api/auth/request', { email }, null)).status, 200);
    assert.equal((await post('/api/auth/request', { email }, null)).status, 429, 'не чаще одного письма в минуту');

    const token = tokenFromMail(outbox[outbox.length - 1]);
    await pool.query("UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE email = $1", [email]);
    assert.equal((await post('/api/auth/verify', { token }, null)).status, 400, 'просроченная ссылка не работает');

    for (const bad of ['', 'abc', 'x'.repeat(43), null]) {
        const { status } = await post('/api/auth/verify', { token: bad }, null);
        assert.equal(status, 400);
    }
});

test('POST с чужого сайта отклоняется, с адреса самого сайта проходит', async () => {
    const { status } = await post('/api/answers', { question_id: 1, answer: 'C' }, cookieA, { Origin: 'https://evil.example' });
    assert.equal(status, 403);
    const same = await post('/api/answers', { question_id: 1, answer: 'C' }, cookieA, { Origin: base });
    assert.equal(same.status, 200, 'страница открыта по тому же адресу, что и сервер');
});

test('Статистика личная: ответы и экзамены одного пользователя не видны другому', async () => {
    const userB = await createUser();
    await post('/api/answers', { question_id: 1, answer: 'A' }, userB.cookie);
    await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'A' }] }, userB.cookie);

    const mistakesB = await get('/api/mistakes', userB.cookie);
    assert.ok(mistakesB.body.some((q) => q.id === 1));
    const fresh = await createUser();
    assert.deepEqual((await get('/api/mistakes', fresh.cookie)).body, []);
    assert.deepEqual((await get('/api/exam/history', fresh.cookie)).body, []);
    assert.equal((await get('/api/exam/history', userB.cookie)).body.length, 1);

    const stats = await get('/api/stats', userB.cookie);
    assert.equal(stats.status, 200);
    const topic = stats.body.topics.find((t) => t.id === 1);
    assert.deepEqual(Object.keys(topic).sort(), ['answered', 'correct_percent', 'id', 'mistakes', 'name', 'question_count']);
    assert.equal(topic.answered, 1);
    assert.equal(topic.correct_percent, 0);
    assert.equal(topic.mistakes, 1);
    const empty = (await get('/api/stats', fresh.cookie)).body.topics.find((t) => t.id === 1);
    assert.equal(empty.answered, 0);
    assert.equal(empty.correct_percent, null);
    assert.equal(empty.mistakes, 0);
});

test('Статистика пользователей и трудные вопросы доступны только админу', async () => {
    for (const path of ['/api/admin/users', '/api/admin/users/1', '/api/admin/hard-questions']) {
        assert.equal((await get(path)).status, 403, `обычному пользователю ${path} недоступен`);
    }
    const admin = await createUser('admin');
    const student = await createUser();
    for (let i = 0; i < 3; i += 1) {
        await post('/api/answers', { question_id: 2, answer: 'A' }, student.cookie);
    }
    await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }] }, student.cookie);

    const users = await get('/api/admin/users', admin.cookie);
    assert.equal(users.status, 200);
    const row = users.body.find((u) => u.id === student.id);
    assert.equal(row.email, student.email);
    assert.equal(row.answers, 4);
    assert.equal(row.exams, 1);
    assert.equal(row.last_exam_percent, 100);
    assert.equal(row.last_exam_passed, true);

    const detail = await get('/api/admin/users/' + student.id, admin.cookie);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.user.email, student.email);
    assert.equal(detail.body.exams.length, 1);
    assert.ok(detail.body.topics.length >= 1);
    assert.equal((await get('/api/admin/users/2147483647', admin.cookie)).status, 404);
    assert.equal((await get('/api/admin/users/abc', admin.cookie)).status, 400);

    const hard = await get('/api/admin/hard-questions', admin.cookie);
    assert.equal(hard.status, 200);
    assert.ok(hard.body.length <= 20);
    for (const q of hard.body) {
        assert.ok(q.answers >= 3 && q.error_percent > 0);
        assert.deepEqual(Object.keys(q).sort(), ['answers', 'category_name', 'error_percent', 'id', 'question_text']);
    }
});

function codeFromMail(mail) {
    const match = /код на странице входа: (\d{6})$/.exec(mail.text);
    assert.ok(match, 'в письме должен быть 6-значный код');
    return match[1];
}

async function requestCode() {
    const email = 'test-' + crypto.randomBytes(6).toString('hex') + TEST_DOMAIN;
    const request = await post('/api/auth/request', { email }, null);
    assert.equal(request.status, 200);
    const mail = outbox[outbox.length - 1];
    return { email, requestId: request.body.request_id, mail, code: codeFromMail(mail) };
}

test('Вход по коду из письма: код одноразовый и гасит ссылку', async () => {
    const { email, requestId, mail, code } = await requestCode();

    const ok = await post('/api/auth/verify-code', { email: email.toUpperCase(), request_id: requestId, code }, null);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { email, role: 'user' });
    const cookie = sidFrom(ok.headers);
    assert.ok(cookie, 'ставится cookie сеанса');
    assert.equal((await get('/api/me', cookie)).status, 200);

    assert.equal((await post('/api/auth/verify-code', { email, request_id: requestId, code }, null)).status, 400, 'код одноразовый');
    assert.equal((await post('/api/auth/verify', { token: tokenFromMail(mail) }, null)).status, 400, 'после входа по коду ссылка не работает');
});

test('Вход по коду: 5 неверных попыток гасят код, но не ссылку; неверный формат отклоняется', async () => {
    const { email, requestId, mail, code } = await requestCode();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
        assert.equal((await post('/api/auth/verify-code', { email, request_id: requestId, code: wrong }, null)).status, 400);
    }
    assert.equal((await post('/api/auth/verify-code', { email, request_id: requestId, code }, null)).status, 400, 'после 5 ошибок верный код уже не принимается');
    assert.equal((await post('/api/auth/verify', { token: tokenFromMail(mail) }, null)).status, 200, 'ссылка из письма продолжает работать');

    for (const payload of [{}, { email }, { email, code }, { email, request_id: requestId }, { email, request_id: requestId, code: '12345' },
        { email, request_id: requestId, code: 'abcdef' }, { email, request_id: requestId, code: 123456 }, { email: 'bad', request_id: requestId, code: '123456' },
        { email, request_id: 'short', code: '123456' }]) {
        assert.equal((await post('/api/auth/verify-code', payload, null)).status, 400, `ожидался 400 для ${JSON.stringify(payload)}`);
    }
});

test('Вход по коду: без номера запроса чужие попытки не расходуются', async () => {
    const { email, requestId, code } = await requestCode();
    const bogus = crypto.randomBytes(32).toString('base64url');
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
        assert.equal((await post('/api/auth/verify-code', { email, request_id: bogus, code: wrong }, null)).status, 400);
    }
    assert.equal((await post('/api/auth/verify-code', { email, request_id: bogus, code }, null)).status, 400, 'верный код с чужим номером не принимается');
    const ok = await post('/api/auth/verify-code', { email, request_id: requestId, code }, null);
    assert.equal(ok.status, 200, 'владелец запроса входит своим кодом');
});

test('Код хранится как HMAC, а не как простой хеш', async () => {
    const { email, code } = await requestCode();
    const plain = crypto.createHash('sha256').update(code).digest();
    const row = await pool.query('SELECT code_hash, request_hash FROM login_tokens WHERE email = $1', [email]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].code_hash.equals(plain), false);
    assert.ok(row.rows[0].request_hash, 'хранится хеш номера запроса');
});

test('Вход по ссылке гасит код из того же письма', async () => {
    const { email, requestId, mail, code } = await requestCode();
    assert.equal((await post('/api/auth/verify', { token: tokenFromMail(mail) }, null)).status, 200);
    assert.equal((await post('/api/auth/verify-code', { email, request_id: requestId, code }, null)).status, 400);
});

test('Параллельные запросы письма не обходят лимит на адрес', async () => {
    const email = 'test-' + crypto.randomBytes(6).toString('hex') + TEST_DOMAIN;
    const results = await Promise.all(Array.from({ length: 4 }, () => post('/api/auth/request', { email }, null)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 429, 429, 429]);
    const rows = await pool.query('SELECT count(*)::int AS n FROM login_tokens WHERE email = $1', [email]);
    assert.equal(rows.rows[0].n, 1);
});

test('Проверка экзамена ограничена 20 разами в час на пользователя', async () => {
    const user = await createUser();
    for (let i = 0; i < 20; i += 1) {
        const r = await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }] }, user.cookie);
        assert.equal(r.status, 200, `проверка ${i + 1} проходит`);
    }
    const blocked = await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }] }, user.cookie);
    assert.equal(blocked.status, 429);
    const other = await post('/api/exam/check', { answers: [{ question_id: 1, answer: 'C' }] }, (await createUser()).cookie);
    assert.equal(other.status, 200, 'лимит у каждого пользователя свой');
});

test('Экзамен без выбора тем не берёт вопросы из тем вне экзамена', async () => {
    const outside = (await pool.query('SELECT id FROM categories WHERE NOT in_exam')).rows.map((r) => r.id);
    assert.ok(outside.length >= 1, 'есть хотя бы одна тема вне экзамена');
    const exam = await get('/api/exam?count=200');
    assert.equal(exam.status, 200);
    assert.ok(exam.body.every((q) => !outside.includes(q.category_id)));
    const chosen = await get('/api/exam?count=5&categories=' + outside[0]);
    assert.equal(chosen.status, 200, 'при явном выборе тема вне экзамена доступна');
    assert.ok(chosen.body.every((q) => q.category_id === outside[0]));
});

test('Материал для собеседования доступен только после входа', async () => {
    const anonymous = await fetch(base + '/api/materials/interview');
    assert.equal(anonymous.status, 401);
    const response = await fetch(base + '/api/materials/interview', { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    const text = await response.text();
    assert.match(text, /^# Собеседование DBA/);
    for (let n = 1; n <= 8; n += 1) {
        assert.ok(text.includes(`\n## ${n}. `), `в материале есть раздел ${n}`);
    }
});

test('Материал «Память процесса» доступен только после входа, чужие имена отклоняются', async () => {
    assert.equal((await fetch(base + '/api/materials/memory')).status, 401);
    const response = await fetch(base + '/api/materials/memory', { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    const text = await response.text();
    assert.match(text, /^# Память процесса/);
    for (let n = 1; n <= 13; n += 1) assert.ok(text.includes(`\n## ${n}. `), `в материале есть раздел ${n}`);
    for (const name of ['nope', '..%2FREADME', 'INTERVIEW', 'constructor', '__proto__']) {
        const other = await fetch(base + '/api/materials/' + name, { headers: { Cookie: cookieA } });
        assert.equal(other.status, 404, name);
        assert.deepEqual(await other.json(), { error: 'Материал не найден' });
    }
});

test('Материал «Системные вызовы и режимы процессора» доступен только после входа', async () => {
    assert.equal((await fetch(base + '/api/materials/syscalls')).status, 401);
    const response = await fetch(base + '/api/materials/syscalls', { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    const text = await response.text();
    assert.match(text, /^# Системные вызовы и режимы процессора/);
    for (let n = 1; n <= 14; n += 1) assert.ok(text.includes(`\n## ${n}. `), `в материале есть раздел ${n}`);
    assert.ok(!text.includes('**'), 'страница не показывает жирный шрифт');
});

test('Материал «Планировщик и EXPLAIN» доступен только после входа', async () => {
    assert.equal((await fetch(base + '/api/materials/planner')).status, 401);
    const response = await fetch(base + '/api/materials/planner', { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/markdown/);
    const text = await response.text();
    assert.match(text, /^# Планировщик и EXPLAIN/);
    for (let n = 1; n <= 14; n += 1) assert.ok(text.includes(`\n## ${n}. `), `в материале есть раздел ${n}`);
    assert.ok(!text.includes('**'), 'страница не показывает жирный шрифт');
});

test('Защитные заголовки есть, X-Powered-By не отдаётся', async () => {
    for (const path of ['/', '/api/me']) {
        const response = await fetch(base + path);
        assert.equal(response.headers.get('x-powered-by'), null, `X-Powered-By не отдаётся для ${path}`);
        assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
        assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        await response.arrayBuffer();
    }
});

test('Просмотр ссылки показывает владельца и не расходует её', async () => {
    const { email, mail } = await requestCode();
    const token = tokenFromMail(mail);
    const peek = await post('/api/auth/peek', { token }, null);
    assert.equal(peek.status, 200);
    assert.deepEqual(peek.body, { email });
    assert.equal((await post('/api/auth/peek', { token }, null)).status, 200, 'повторный просмотр тоже работает');
    assert.equal((await post('/api/auth/verify', { token }, null)).status, 200, 'после просмотра ссылка по-прежнему входит');
    assert.equal((await post('/api/auth/peek', { token }, null)).status, 400, 'использованная ссылка не показывается');
    for (const bad of [undefined, '', 'abc', 'x'.repeat(43)]) {
        assert.equal((await post('/api/auth/peek', { token: bad }, null)).status, 400);
    }
});

test('Выход удаляет сеанс на сервере', async () => {
    const user = await createUser();
    assert.equal((await get('/api/me', user.cookie)).status, 200);
    const out = await post('/api/auth/logout', {}, user.cookie);
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') || '', /sid=;/, 'cookie сеанса очищается');
    assert.equal((await get('/api/me', user.cookie)).status, 401);
});
