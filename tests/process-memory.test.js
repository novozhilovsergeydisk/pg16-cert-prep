const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const { questions: source } = require('../scripts/questions/035_process_memory');

let server;
let base;
let user;
let category;

async function get(path) {
    const response = await fetch(base + path, { headers: { Cookie: user.cookie } });
    return { status: response.status, body: await response.json() };
}

before(async () => {
    // Свой префикс: очистка api.test.js удаляет пользователей test-…@example.test, а файлы идут параллельно.
    const email = 'memory-' + crypto.randomBytes(6).toString('hex') + '@example.test';
    const created = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, 'user']);
    const sid = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), created.rows[0].id]
    );
    user = { id: created.rows[0].id, cookie: 'sid=' + sid };
    category = (await pool.query("SELECT id, in_exam FROM categories WHERE left(name, 3) = '18.'")).rows[0];
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            base = 'http://127.0.0.1:' + server.address().port;
            resolve();
        });
    });
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await pool.end();
});

test('Раздел 18: создан вне экзамена, 30 вопросов из исходника, пояснения ко всем вариантам', async () => {
    assert.ok(category, 'Нужны миграции 034 и 035');
    assert.equal(category.in_exam, false);
    const { rows } = await pool.query('SELECT question_text, options, correct_answer, option_notes FROM questions WHERE category_id = $1', [category.id]);
    assert.equal(rows.length, 30);
    assert.deepEqual(rows.map((q) => q.question_text).sort(), source.map((q) => q.q).sort());
    for (const q of rows) {
        assert.deepEqual(Object.keys(q.option_notes).sort(), Object.keys(q.options).sort());
        assert.ok([...q.correct_answer].every((key) => key in q.options));
    }
});

test('Раздел 18: в списке тем отмечен как вне экзамена', async () => {
    const { status, body } = await get('/api/categories');
    assert.equal(status, 200);
    const item = body.find((c) => c.id === category.id);
    assert.equal(item.in_exam, false);
    assert.equal(item.question_count, 30);
});

test('Раздел 18: в экзамен по умолчанию не попадает, при явном выборе — попадает', async () => {
    const ids = new Set((await pool.query('SELECT id FROM questions WHERE category_id = $1', [category.id])).rows.map((r) => r.id));
    const byDefault = await get('/api/exam?count=50');
    assert.equal(byDefault.status, 200);
    assert.ok(byDefault.body.every((q) => !ids.has(q.id)), 'вопрос раздела 18 попал в экзамен по умолчанию');
    const chosen = await get('/api/exam?count=30&categories=' + category.id);
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.length, 30);
    assert.ok(chosen.body.every((q) => ids.has(q.id)));
    assert.ok(chosen.body.every((q) => !('correct_answer' in q) && !('option_notes' in q)));
});
