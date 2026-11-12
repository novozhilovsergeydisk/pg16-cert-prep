const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const fetch = require('./paced-fetch')();

let server;
let base;
const users = [];

async function createUser() {
    // Свой префикс: очистка api.test.js удаляет пользователей test-…@example.test, а файлы идут параллельно.
    const email = 'check-' + crypto.randomBytes(6).toString('hex') + '@example.test';
    const created = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, 'user']);
    const sid = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), created.rows[0].id]
    );
    const user = { id: created.rows[0].id, cookie: 'sid=' + sid };
    users.push(user);
    return user;
}

async function post(path, payload, user) {
    const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie } : {}) },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
}

before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            base = 'http://127.0.0.1:' + server.address().port;
            resolve();
        });
    });
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const user of users) await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await pool.end();
});

async function topicWithManyQuestions() {
    return (await pool.query('SELECT category_id AS id FROM questions GROUP BY 1 HAVING count(*) >= 16 ORDER BY 1 LIMIT 1')).rows[0].id;
}

// Правильность карточки знает только сервер: проверяем по таблицам.
async function cardTruth(batchId, questionId) {
    const batch = (await pool.query('SELECT cards FROM option_check_batches WHERE id=$1', [batchId])).rows[0];
    return batch.cards.find((card) => card.question_id === questionId);
}

test('Порция: 16 разных вопросов, верных и неверных вариантов поровну, ключи не раскрываются', async () => {
    const user = await createUser();
    const category = await topicWithManyQuestions();
    const { status, body } = await post('/api/option-checks/batches', { category_id: category }, user);
    assert.equal(status, 201);
    assert.equal(body.cards.length, 16);
    assert.equal(new Set(body.cards.map((card) => card.question_id)).size, 16);
    for (const card of body.cards) {
        assert.deepEqual(Object.keys(card).sort(), ['multi', 'option_text', 'question_id', 'question_text']);
        assert.ok(card.option_text && card.question_text);
    }
    const stored = (await pool.query('SELECT cards FROM option_check_batches WHERE id=$1', [body.id])).rows[0].cards;
    assert.equal(stored.filter((card) => card.is_correct).length, 8);
    assert.equal(stored.filter((card) => !card.is_correct).length, 8);
    for (const card of stored) {
        const q = (await pool.query('SELECT options, correct_answer FROM questions WHERE id=$1', [card.question_id])).rows[0];
        assert.equal(q.correct_answer.includes(card.key), card.is_correct);
    }
    const shown = body.cards.find((card) => card.question_id === stored[0].question_id);
    const q0 = (await pool.query('SELECT options FROM questions WHERE id=$1', [stored[0].question_id])).rows[0];
    assert.equal(shown.option_text, q0.options[stored[0].key]);
});

test('Ответ: верный и неверный выбор, результат с пояснениями; обычная статистика не меняется', async () => {
    const user = await createUser();
    const category = await topicWithManyQuestions();
    const { body: batch } = await post('/api/option-checks/batches', { category_id: category }, user);
    const [first, second] = batch.cards;
    const truth1 = await cardTruth(batch.id, first.question_id);
    const truth2 = await cardTruth(batch.id, second.question_id);
    const ok = await post('/api/option-checks', { batch_id: batch.id, question_id: first.question_id, fits: truth1.is_correct }, user);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.right, true);
    assert.equal(ok.body.option_fits, truth1.is_correct);
    assert.ok(ok.body.explanation && ok.body.option_note);
    const bad = await post('/api/option-checks', { batch_id: batch.id, question_id: second.question_id, fits: !truth2.is_correct }, user);
    assert.equal(bad.status, 200);
    assert.equal(bad.body.right, false);
    const saved = (await pool.query('SELECT is_right FROM option_check_answers WHERE user_id=$1 ORDER BY id', [user.id])).rows;
    assert.deepEqual(saved.map((row) => row.is_right), [true, false]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM answer_log WHERE user_id=$1', [user.id])).rows[0].n, 0);
});

test('Повторный ответ возвращает сохранённый результат, смена ответа — 409, запись одна', async () => {
    const user = await createUser();
    const { body: batch } = await post('/api/option-checks/batches', { category_id: await topicWithManyQuestions() }, user);
    const card = batch.cards[0];
    const truth = await cardTruth(batch.id, card.question_id);
    const first = await post('/api/option-checks', { batch_id: batch.id, question_id: card.question_id, fits: truth.is_correct }, user);
    const again = await post('/api/option-checks', { batch_id: batch.id, question_id: card.question_id, fits: truth.is_correct }, user);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first.body);
    const changed = await post('/api/option-checks', { batch_id: batch.id, question_id: card.question_id, fits: !truth.is_correct }, user);
    assert.equal(changed.status, 409);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM option_check_answers WHERE user_id=$1', [user.id])).rows[0].n, 1);
});

test('Проверки доступа и параметров: чужая порция, чужой вопрос, плохие данные, без входа', async () => {
    const owner = await createUser();
    const other = await createUser();
    const { body: batch } = await post('/api/option-checks/batches', { category_id: await topicWithManyQuestions() }, owner);
    const card = batch.cards[0];
    assert.equal((await post('/api/option-checks', { batch_id: batch.id, question_id: card.question_id, fits: true }, other)).status, 404);
    const notInBatch = (await pool.query('SELECT id FROM questions WHERE id <> ALL($1::int[]) LIMIT 1', [batch.cards.map((c) => c.question_id)])).rows[0].id;
    assert.equal((await post('/api/option-checks', { batch_id: batch.id, question_id: notInBatch, fits: true }, owner)).status, 400);
    for (const bad of [{ batch_id: batch.id, question_id: card.question_id, fits: 'yes' }, { batch_id: 'x', question_id: 1, fits: true }, { batch_id: batch.id, fits: true }, {}]) {
        assert.equal((await post('/api/option-checks', bad, owner)).status, 400);
    }
    assert.equal((await post('/api/option-checks/batches', { category_id: 2147483647 }, owner)).status, 404);
    assert.equal((await post('/api/option-checks/batches', { category_id: 'abc' }, owner)).status, 400);
    assert.equal((await post('/api/option-checks/batches', { category_id: 1 })).status, 401);
    assert.equal((await post('/api/option-checks', { batch_id: 1, question_id: 1, fits: true })).status, 401);
});

test('Следующая порция начинается с вопросов, которые пользователь в этом режиме ещё не видел', async () => {
    const user = await createUser();
    const category = await topicWithManyQuestions();
    const { body: first } = await post('/api/option-checks/batches', { category_id: category }, user);
    for (const card of first.cards) {
        const truth = await cardTruth(first.id, card.question_id);
        await post('/api/option-checks', { batch_id: first.id, question_id: card.question_id, fits: truth.is_correct }, user);
    }
    const { body: second } = await post('/api/option-checks/batches', { category_id: category }, user);
    const seen = new Set(first.cards.map((card) => card.question_id));
    const total = (await pool.query('SELECT count(*)::int AS n FROM questions WHERE category_id=$1', [category])).rows[0].n;
    const fresh = second.cards.filter((card) => !seen.has(card.question_id)).length;
    assert.equal(fresh, Math.min(16, total - 16), 'сначала вопросы, которых пользователь ещё не видел');
});
