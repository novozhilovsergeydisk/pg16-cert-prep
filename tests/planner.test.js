const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const { questions: source } = require('../scripts/questions/049_planner');

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
    const email = 'planner-' + crypto.randomBytes(6).toString('hex') + '@example.test';
    const created = await pool.query('INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id', [email, 'user']);
    const sid = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        [crypto.createHash('sha256').update(sid).digest(), created.rows[0].id]
    );
    user = { id: created.rows[0].id, cookie: 'sid=' + sid };
    category = (await pool.query("SELECT id, in_exam FROM categories WHERE left(name, 3) = '20.'")).rows[0];
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

// Исходник и база согласованы: тексты вопросов, вариантов, пояснений и ключи.
async function assertMatchesSource(items) {
    for (const item of items) {
        const { rows } = await pool.query('SELECT options, correct_answer, explanation, option_notes FROM questions WHERE question_text = $1', [item.q]);
        assert.equal(rows.length, 1, 'нет вопроса: ' + item.q.slice(0, 50));
        const q = rows[0];
        assert.equal(q.explanation, item.e);
        assert.deepEqual(Object.keys(q.option_notes).sort(), Object.keys(q.options).sort());
        const correct = [];
        for (const [text, ok, note] of item.opts) {
            const key = Object.keys(q.options).find((k) => q.options[k] === text);
            assert.ok(key, 'нет варианта: ' + text.slice(0, 50));
            assert.equal(q.option_notes[key], note);
            if (ok) correct.push(key);
        }
        assert.equal(q.correct_answer, correct.sort().join(''));
    }
}

test('Раздел 20: создан вне экзамена, 30 вопросов из исходника, пояснения ко всем вариантам', async () => {
    assert.ok(category, 'Нужны миграции 048 и 049');
    assert.equal(category.in_exam, false);
    const { rows } = await pool.query('SELECT question_text FROM questions WHERE category_id = $1', [category.id]);
    assert.equal(rows.length, 30);
    assert.deepEqual(rows.map((q) => q.question_text).sort(), source.map((q) => q.q).sort());
    await assertMatchesSource(source);
});

test('Раздел 20: в списке тем отмечен как вне экзамена, в экзамен по умолчанию не попадает', async () => {
    const { status, body } = await get('/api/categories');
    assert.equal(status, 200);
    const item = body.find((c) => c.id === category.id);
    assert.equal(item.in_exam, false);
    assert.equal(item.question_count, 30);
    const ids = new Set((await pool.query('SELECT id FROM questions WHERE category_id = $1', [category.id])).rows.map((r) => r.id));
    const byDefault = await get('/api/exam?count=50');
    assert.equal(byDefault.status, 200);
    assert.ok(byDefault.body.every((q) => !ids.has(q.id)), 'вопрос раздела 20 попал в экзамен по умолчанию');
    const chosen = await get('/api/exam?count=20&categories=' + category.id);
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.length, 20);
    assert.ok(chosen.body.every((q) => ids.has(q.id) && !('correct_answer' in q) && !('option_notes' in q)));
});
