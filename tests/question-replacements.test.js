const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { questions: replacements } = require('../scripts/questions/029_replace_semantic_duplicates');
const { buildMigration } = require('../scripts/gen-question-replacements');
const sql = fs.readFileSync(path.join(__dirname, '../migrations/029_replace_semantic_duplicates.sql'), 'utf8');
const { later } = require('./later-fixes');

// Текст вопроса после поздних исправлений (tests/later-fixes.js): в банке он мог измениться после 029.
const latestText = (text) => later.reduce((t, f) => (f.kind === 'question' && f.q === t ? f.new : t), text);

after(() => pool.end());

// Тестируется настоящий SQL на временных копиях таблиц, без изменения банка вопросов.
// ID намеренно отличаются от ID локальной базы и от серверного отчёта.
async function fixture(run) {
    const db = await pool.connect().catch(() => { throw new Error('Нет подключения к тестовой БД'); });
    try {
        await db.query(`
            CREATE TEMP TABLE categories (LIKE public.categories INCLUDING CONSTRAINTS);
            INSERT INTO categories SELECT * FROM public.categories;
            UPDATE categories SET id = id + 10000;
            CREATE TEMP TABLE questions (LIKE public.questions INCLUDING CONSTRAINTS);
            INSERT INTO questions SELECT * FROM public.questions;
            UPDATE questions SET id = id + 20000, category_id = category_id + 10000;
        `);
        const targets = [];
        for (const r of replacements) {
            const result = await db.query(`UPDATE questions q SET question_text=$1
                FROM categories c WHERE c.id=q.category_id AND left(c.name,3)=$2
                AND q.question_text IN ($1,$3,$4) RETURNING q.id`, [r.oldQuestion, r.t + '.', r.q, latestText(r.q)]);
            assert.equal(result.rowCount, 1, 'Исходный или заменённый вопрос должен присутствовать в банке');
            targets.push(result.rows[0].id);
        }
        await run(db, targets);
    } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        throw new Error('Не удалось выполнить проверку миграции 029');
    } finally {
        await db.query('ROLLBACK');
        await db.query('DROP TABLE IF EXISTS pg_temp.questions, pg_temp.categories');
        db.release();
    }
}

const readQuestions = async (db) => (await db.query('SELECT * FROM questions ORDER BY id')).rows;
const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

test('029: SQL воспроизводится из источника, все новые вопросы различны', () => {
    assert.equal(buildMigration(), sql);
    assert.equal(new Set(replacements.map((q) => normalize(q.q))).size, 16);
});

test('029: меняются ровно 16 вопросов; ID, категории и остальные вопросы сохраняются', async () => {
    await fixture(async (db, targets) => {
        const before = await readQuestions(db);
        await db.query(sql);
        const after = await readQuestions(db);
        assert.equal(after.length, before.length);
        assert.deepEqual(after.map((q) => [q.id, q.category_id]), before.map((q) => [q.id, q.category_id]));
        assert.deepEqual(after.filter((q) => !targets.includes(q.id)), before.filter((q) => !targets.includes(q.id)));
        assert.equal(after.filter((q, i) => JSON.stringify(q) !== JSON.stringify(before[i])).length, 16);
        assert.equal(new Set(after.map((q) => normalize(q.question_text))).size, after.length);
        for (const [i, r] of replacements.entries()) {
            const actual = after.find((q) => q.id === targets[i]);
            assert.equal(actual.question_text, r.q);
            assert.equal(actual.explanation, r.e);
            assert.deepEqual(Object.values(actual.options).sort(), r.opts.map(([text]) => text).sort());
            assert.deepEqual(actual.correct_answer.split('').map((key) => actual.options[key]).sort(),
                r.opts.filter(([, correct]) => correct).map(([text]) => text).sort());
            for (const [key, text] of Object.entries(actual.options)) {
                assert.equal(actual.option_notes[key], r.opts.find(([option]) => option === text)[2]);
            }
        }
        await db.query(sql);
        assert.deepEqual(await readQuestions(db), after, 'Повторный запуск не меняет данные');
    });
});

async function expectAtomicFailure(db, mutate) {
    await mutate();
    const before = await readQuestions(db);
    await assert.rejects(db.query(sql), (error) => error.code === 'P0001');
    await db.query('ROLLBACK');
    assert.deepEqual(await readQuestions(db), before, 'Ранние замены тоже должны откатиться');
}

test('029: отсутствие последнего вопроса откатывает все предыдущие замены', async () => {
    await fixture((db, targets) => expectAtomicFailure(db,
        () => db.query('DELETE FROM questions WHERE id=$1', [targets.at(-1)])));
});

test('029: одновременное наличие старого и нового текста откатывает весь пакет', async () => {
    await fixture((db, targets) => expectAtomicFailure(db, async () => {
        const original = (await db.query('SELECT * FROM questions WHERE id=$1', [targets.at(-1)])).rows[0];
        await db.query(`INSERT INTO questions(id,category_id,question_text,options,correct_answer,explanation,option_notes)
            VALUES(999999,$1,$2,$3,$4,$5,$6)`, [original.category_id, replacements.at(-1).q,
            original.options, original.correct_answer, original.explanation, original.option_notes]);
    }));
});

test('029: вопрос в чужом разделе не принимается за нужный', async () => {
    await fixture((db, targets) => expectAtomicFailure(db,
        () => db.query('UPDATE questions SET category_id=(SELECT min(id) FROM categories) WHERE id=$1', [targets.at(-1)])));
});

test('029: одноимённый вопрос в другом разделе не изменяется', async () => {
    await fixture(async (db, targets) => {
        const original = (await db.query('SELECT * FROM questions WHERE id=$1', [targets.at(-1)])).rows[0];
        await db.query(`INSERT INTO questions(id,category_id,question_text,options,correct_answer,explanation,option_notes)
            VALUES(999999,(SELECT min(id) FROM categories),$1,$2,$3,$4,$5)`,
        [original.question_text, original.options, original.correct_answer, original.explanation, original.option_notes]);
        const before = (await db.query('SELECT * FROM questions WHERE id=999999')).rows;
        await db.query(sql);
        assert.deepEqual((await db.query('SELECT * FROM questions WHERE id=999999')).rows, before);
    });
});
