const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { questions: additions } = require('../scripts/questions/030_database_object_basics');
const sql = fs.readFileSync(path.join(__dirname, '../migrations/030_database_object_basics.sql'), 'utf8');
const normalize = (text) => text.trim().replace(/\s+/g, ' ');
const read = async (db) => (await db.query('SELECT * FROM questions ORDER BY id')).rows;
after(() => pool.end());

async function fixture(run) {
    const db = await pool.connect().catch(() => { throw new Error('Нет подключения к локальной БД'); });
    try {
        await db.query(`
            CREATE TEMP TABLE categories (LIKE public.categories INCLUDING CONSTRAINTS);
            INSERT INTO categories SELECT * FROM public.categories;
            UPDATE categories SET id=id+50000;
            CREATE TEMP SEQUENCE object_basics_ids START 1000000;
            CREATE TEMP TABLE questions (LIKE public.questions INCLUDING CONSTRAINTS);
            ALTER TABLE questions ALTER COLUMN id SET DEFAULT nextval('pg_temp.object_basics_ids');
            INSERT INTO questions SELECT * FROM public.questions;
            UPDATE questions SET category_id=category_id+50000;
        `);
        await db.query('DELETE FROM questions WHERE question_text=ANY($1::text[])', [additions.map((q) => q.q)]);
        await run(db);
    } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        throw new Error('Не удалось выполнить проверку миграции 030');
    } finally {
        await db.query('ROLLBACK');
        await db.query('DROP TABLE IF EXISTS pg_temp.questions, pg_temp.categories, pg_temp.question_seed');
        await db.query('DROP SEQUENCE IF EXISTS pg_temp.object_basics_ids');
        db.release();
    }
}

test('030: 30 вопросов, обе пропорции 21 к 9, нет повторов и пустых пояснений', () => {
    assert.equal(additions.length, 30);
    assert.equal(additions.filter((q) => q.kind === 'single').length, 21);
    assert.equal(additions.filter((q) => q.kind === 'multi').length, 9);
    assert.equal(additions.filter((q) => q.opts.length === 4).length, 21);
    assert.equal(additions.filter((q) => q.opts.length === 5).length, 9);
    assert.equal(new Set(additions.map((q) => normalize(q.q))).size, 30);
    for (const q of additions) {
        assert.ok(q.e && q.sources.length);
        assert.ok(q.opts.every(([text, , note]) => text && note));
        assert.equal(new Set(q.opts.map(([text]) => text)).size, q.opts.length);
    }
    for (const size of [4, 5]) {
        for (const kind of ['single', 'multi']) assert.ok(additions.some((q) => q.opts.length === size && q.kind === kind));
    }
});

test('030: добавляет только 30 новых вопросов, сохраняет старые и безопасно повторяется', async () => {
    await fixture(async (db) => {
        const before = await read(db);
        await db.query(sql);
        const after = await read(db);
        assert.equal(after.length, before.length + 30);
        assert.deepEqual(after.filter((q) => q.id < 1000000), before);
        assert.equal(new Set(after.map((q) => normalize(q.question_text))).size, after.length);
        const categories = (await db.query('SELECT * FROM categories')).rows;
        for (const expected of additions) {
            const q = after.find((q) => q.question_text === expected.q);
            assert.ok(q);
            assert.equal(categories.find((c) => c.id === q.category_id).name.slice(0, 2), expected.t);
            assert.equal(q.explanation, expected.e);
            assert.deepEqual(Object.values(q.options).sort(), expected.opts.map(([text]) => text).sort());
            assert.deepEqual(q.correct_answer.split('').map((k) => q.options[k]).sort(),
                expected.opts.filter(([, correct]) => correct).map(([text]) => text).sort());
            for (const [key, text] of Object.entries(q.options)) assert.equal(q.option_notes[key], expected.opts.find(([option]) => option === text)[2]);
            assert.equal(Object.hasOwn(q.options, 'E'), expected.opts.length === 5);
        }
        const sequence = (await db.query('SELECT last_value FROM pg_temp.object_basics_ids')).rows;
        await db.query(sql);
        assert.deepEqual(await read(db), after);
        assert.deepEqual((await db.query('SELECT last_value FROM pg_temp.object_basics_ids')).rows, sequence);
    });
});

async function expectFailure(db, codes) {
    const before = await read(db);
    await assert.rejects(db.query(sql), (e) => codes.includes(e.code));
    await db.query('ROLLBACK');
    assert.deepEqual(await read(db), before);
}

test('030: отсутствие раздела отменяет весь пакет', async () => {
    await fixture(async (db) => {
        await db.query("DELETE FROM categories WHERE left(name,3)='08.'");
        await expectFailure(db, ['23502']);
    });
});

test('030: точное совпадение текста в другом разделе считается конфликтом', async () => {
    await fixture(async (db) => {
        await db.query(sql);
        await db.query("UPDATE questions SET category_id=(SELECT id FROM categories WHERE left(name,3)='01.') WHERE question_text=$1", [additions[0].q]);
        await expectFailure(db, ['P0001']);
    });
});

test('030: повторный запуск не перезаписывает изменённые ключи ответов', async () => {
    await fixture(async (db) => {
        await db.query(sql);
        const q = (await db.query('SELECT * FROM questions WHERE question_text=$1', [additions[0].q])).rows[0];
        await db.query('UPDATE questions SET correct_answer=$1 WHERE id=$2', [Object.keys(q.options).find((k) => k !== q.correct_answer), q.id]);
        await expectFailure(db, ['P0001']);
    });
});

test('030: лишние пробелы не позволяют добавить копию существующего вопроса', async () => {
    await fixture(async (db) => {
        await db.query(sql);
        await db.query('UPDATE questions SET question_text=$1 WHERE question_text=$2', [additions[0].q.replaceAll(' ', '  '), additions[0].q]);
        await expectFailure(db, ['P0001']);
    });
});
