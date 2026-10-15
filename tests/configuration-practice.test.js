const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const data = require('../scripts/questions/031_configuration_practice');
const { questions: additions, explanationUpdates: fixes } = data;
const sql = fs.readFileSync(path.join(__dirname, '../migrations/031_configuration_practice.sql'), 'utf8');
after(() => pool.end());

const read = async (db) => (await db.query('SELECT * FROM questions ORDER BY id')).rows;
const normalized = (text) => text.trim().replace(/\s+/g, ' ');

async function fixture(run) {
    const db = await pool.connect().catch(() => { throw new Error('Нет подключения к локальной БД'); });
    try {
        await db.query(`
            CREATE TEMP TABLE categories (LIKE public.categories INCLUDING CONSTRAINTS);
            INSERT INTO categories SELECT * FROM public.categories;
            UPDATE categories SET id=id+50000;
            CREATE TEMP SEQUENCE configuration_practice_ids START 1000000;
            CREATE TEMP TABLE questions (LIKE public.questions INCLUDING CONSTRAINTS);
            ALTER TABLE questions ALTER COLUMN id SET DEFAULT nextval('pg_temp.configuration_practice_ids');
            INSERT INTO questions SELECT * FROM public.questions;
            UPDATE questions SET id=id+50000, category_id=category_id+50000;
        `);
        await db.query('DELETE FROM questions WHERE question_text=ANY($1::text[])', [additions.map((q) => q.q)]);
        for (const fix of fixes) {
            const changed = await db.query(`UPDATE questions SET explanation=$1, option_notes=$2
                WHERE question_text=$3`, [fix.oldExplanation, fix.oldNotes, fix.q]);
            assert.equal(changed.rowCount, 1);
        }
        await run(db);
    } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        throw new Error('Не удалось выполнить проверку миграции 031');
    } finally {
        await db.query('ROLLBACK');
        await db.query('DROP TABLE IF EXISTS pg_temp.questions, pg_temp.categories, pg_temp.question_seed');
        await db.query('DROP SEQUENCE IF EXISTS pg_temp.configuration_practice_ids');
        db.release();
    }
}

test('031: SQL воспроизводится; расширение генератора не меняет миграцию 030', () => {
    const filename = path.resolve(__dirname, '../scripts/gen-questions.js');
    const realRequire = createRequire(filename);
    for (const name of ['030_database_object_basics', '031_configuration_practice']) {
        let writes = 0;
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            require: (module) => module === 'fs' ? {
                ...fs,
                writeFileSync: (file, generated) => {
                    assert.equal(generated, fs.readFileSync(file, 'utf8'));
                    writes++;
                },
            } : realRequire(module),
            __dirname: path.dirname(filename),
            process: { argv: ['node', filename, path.join(__dirname, '../scripts/questions/' + name + '.js')] },
            console: { log() {} },
        }, { filename });
        assert.equal(writes, 1);
    }
    assert.equal(additions.length, 5);
    assert.equal(fixes.length, 2);
    assert.equal(new Set(additions.map((q) => normalized(q.q))).size, 5);
    assert.ok(additions.every((q) => q.sources.length && q.opts.every(([text, , note]) => text && note)));
});

test('031: добавляет пять вопросов, меняет только пояснения двух прежних и безопасно повторяется', async () => {
    await fixture(async (db) => {
        const before = await read(db);
        await db.query(sql);
        const after = await read(db);
        assert.equal(after.length, before.length + 5);
        assert.equal(new Set(after.map((q) => normalized(q.question_text))).size, after.length);
        for (const previous of before) {
            const fix = fixes.find((f) => f.q === previous.question_text);
            const actual = after.find((q) => q.id === previous.id);
            assert.deepEqual(actual, fix ? { ...previous, explanation: fix.e, option_notes: fix.notes } : previous);
        }
        const categories = (await db.query('SELECT * FROM categories')).rows;
        for (const expected of additions) {
            const actual = after.find((q) => q.question_text === expected.q);
            assert.ok(actual);
            assert.equal(categories.find((c) => c.id === actual.category_id).name.slice(0, 2), expected.t);
            assert.equal(actual.explanation, expected.e);
            assert.deepEqual(Object.values(actual.options).sort(), expected.opts.map(([text]) => text).sort());
            assert.deepEqual(actual.correct_answer.split('').map((key) => actual.options[key]).sort(),
                expected.opts.filter(([, correct]) => correct).map(([text]) => text).sort());
            for (const [key, text] of Object.entries(actual.options)) {
                assert.equal(actual.option_notes[key], expected.opts.find(([option]) => option === text)[2]);
            }
        }
        const sequence = (await db.query('SELECT last_value FROM pg_temp.configuration_practice_ids')).rows;
        await db.query(sql);
        assert.deepEqual(await read(db), after);
        assert.deepEqual((await db.query('SELECT last_value FROM pg_temp.configuration_practice_ids')).rows, sequence);
    });
});

async function expectFailure(db, mutate, codes = ['P0001']) {
    await mutate();
    const before = await read(db);
    await assert.rejects(db.query(sql), (error) => codes.includes(error.code));
    await db.query('ROLLBACK');
    assert.deepEqual(await read(db), before);
}

test('031: отсутствие второго исправляемого вопроса откатывает первое исправление', async () => {
    await fixture((db) => expectFailure(db,
        () => db.query('DELETE FROM questions WHERE question_text=$1', [fixes[1].q])));
});

test('031: дубликат исправляемого вопроса отменяет весь пакет', async () => {
    await fixture((db) => expectFailure(db, () => db.query(`
        INSERT INTO questions(category_id,question_text,options,correct_answer,explanation,option_notes)
        SELECT category_id,question_text,options,correct_answer,explanation,option_notes
        FROM questions WHERE question_text=$1`, [fixes[1].q])));
});

for (const field of ['correct_answer', 'options', 'option_notes', 'explanation']) {
    test('031: неизвестное изменение ' + field + ' старого вопроса не перезаписывается', async () => {
        await fixture((db) => expectFailure(db, () => db.query({
            correct_answer: "UPDATE questions SET correct_answer='C' WHERE question_text=$1",
            options: "UPDATE questions SET options=options || '{\"C\":\"Другой вариант\"}'::jsonb WHERE question_text=$1",
            option_notes: "UPDATE questions SET option_notes=option_notes || '{\"C\":\"Другое пояснение\"}'::jsonb WHERE question_text=$1",
            explanation: "UPDATE questions SET explanation='Другое общее пояснение' WHERE question_text=$1",
        }[field], [fixes[1].q])));
    });
}

test('031: конфликт нового вопроса откатывает оба исправления старых пояснений', async () => {
    await fixture(async (db) => {
        await db.query(sql);
        for (const fix of fixes) {
            await db.query('UPDATE questions SET explanation=$1,option_notes=$2 WHERE question_text=$3',
                [fix.oldExplanation, fix.oldNotes, fix.q]);
        }
        await expectFailure(db, () => db.query("UPDATE questions SET question_text=$1 WHERE question_text=$2",
            [additions[0].q.replaceAll(' ', '  '), additions[0].q]));
    });
});

test('031: отсутствие раздела для нового вопроса откатывает пояснения', async () => {
    await fixture((db) => expectFailure(db,
        () => db.query("DELETE FROM categories WHERE left(name,3)='02.'"), ['23502']));
});

test('031: реальное выполнение SET и SET LOCAL подтверждает ответ для COMMIT и ROLLBACK', async () => {
    const db = await pool.connect().catch(() => { throw new Error('Нет подключения к локальной БД'); });
    try {
        const results = [];
        for (const finish of ['COMMIT', 'ROLLBACK']) {
            await db.query("SET work_mem='8MB'");
            await db.query("BEGIN; SET work_mem='32MB'; SET LOCAL work_mem='64MB'");
            assert.equal((await db.query('SHOW work_mem')).rows[0].work_mem, '64MB');
            await db.query(finish);
            results.push((await db.query('SHOW work_mem')).rows[0].work_mem);
        }
        assert.deepEqual(results, ['32MB', '8MB']);
    } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        throw new Error('Не удалось проверить срок действия параметра');
    } finally {
        await db.query('ROLLBACK');
        await db.query('RESET work_mem');
        db.release();
    }
});
