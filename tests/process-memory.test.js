const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const app = require('../server');
const pool = require('../src/config/db');
const { questions: source035 } = require('../scripts/questions/035_process_memory');
const { questions: source038 } = require('../scripts/questions/038_stack_heap_basics');
const { questions: source040 } = require('../scripts/questions/040_proc_maps');
const { questions: source041 } = require('../scripts/questions/041_postgres_processes_vm');
const { questions: source042 } = require('../scripts/questions/042_proc_basics');
const withLaterFixes = require('./later-fixes');
const source = [...source035, ...source038, ...source040, ...source041, ...source042].map(withLaterFixes);

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

test('Раздел 18: создан вне экзамена, 53 вопроса из исходников (30 + 3 о стеке и куче + 4 о maps + 10 о процессах PostgreSQL и полях Vm + 6 о /proc), пояснения ко всем вариантам', async () => {
    assert.ok(category, 'Нужны миграции 034 и 035');
    assert.equal(category.in_exam, false);
    const { rows } = await pool.query('SELECT question_text, options, correct_answer, option_notes FROM questions WHERE category_id = $1', [category.id]);
    assert.equal(rows.length, 53);
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
    assert.equal(item.question_count, 53);
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

test('Раздел 18: уточнения миграции 036 применены, прежних формулировок нет, ключи не тронуты', async () => {
    const { fixes } = require('../scripts/questions/036_process_memory_fixes');
    assert.equal(fixes.length, 10);
    const texts = new Set(source.map((q) => q.q));
    for (const fix of fixes) {
        // Более поздняя правка (062) могла переименовать вопрос: в базе его итоговый текст.
        const renamed = (name) => withLaterFixes.later.reduce((n, f) => (f.kind === 'question' && f.q === n ? f.new : n), name);
        const questionText = renamed(fix.kind === 'question' ? fix.new : fix.q);
        assert.ok(texts.has(questionText), 'вопрос из исправления не найден в исходнике');
        const { rows } = await pool.query('SELECT question_text, options, explanation, option_notes FROM questions WHERE question_text = $1', [questionText]);
        assert.equal(rows.length, 1, 'Нужна миграция 036');
        const q = rows[0];
        if (fix.kind === 'explanation') assert.equal(q.explanation, fix.new);
        if (fix.kind === 'option') {
            // Более поздняя правка (062) могла ещё раз переписать этот вариант: тогда ожидается её результат.
            // Поздние правки (062, 064) идут цепочкой: следующая ищет вариант по тексту, который оставила предыдущая.
            let expectedText = fix.newOpt || fix.opt;
            let expectedNote = fix.newNote;
            let name = fix.kind === 'question' ? fix.new : fix.q;
            for (const f of withLaterFixes.later) {
                if (f.kind === 'question' && f.q === name) name = f.new;
                else if (f.kind === 'option' && f.q === name && f.opt === expectedText) {
                    expectedText = f.newOpt || expectedText;
                    expectedNote = f.newNote || expectedNote;
                }
            }
            const key = Object.keys(q.options).find((k) => q.options[k] === expectedText);
            assert.ok(key, 'вариант не найден: ' + expectedText.slice(0, 50));
            if (expectedNote) assert.equal(q.option_notes[key], expectedNote);
            assert.notEqual(q.options[key], fix.newOpt ? fix.opt : undefined);
        }
    }
    // Исходник и база согласованы: у каждого варианта исходника есть такой же текст и пояснение в базе.
    for (const item of source) {
        const q = (await pool.query('SELECT options, option_notes, explanation FROM questions WHERE question_text = $1', [item.q])).rows[0];
        assert.equal(q.explanation, item.e);
        for (const [text, , note] of item.opts) {
            const key = Object.keys(q.options).find((k) => q.options[k] === text);
            assert.ok(key, 'нет варианта: ' + text.slice(0, 50));
            assert.equal(q.option_notes[key], note);
        }
    }
});
