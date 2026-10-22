const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { questions: source } = require('../scripts/questions/050_query_protocol');
after(() => pool.end());

test('Раздел 04: семь вопросов о протоколе, подготовленных операторах и курсорах в экзаменационной теме, согласованы с исходником', async () => {
    const { rows } = await pool.query(
        "SELECT q.question_text FROM questions q JOIN categories c ON c.id = q.category_id WHERE left(c.name, 3) = '04.' AND c.in_exam AND q.question_text = ANY($1)",
        [source.map((q) => q.q)]
    );
    assert.equal(rows.length, 7, 'Нужна миграция 050');
    for (const item of source) {
        const q = (await pool.query('SELECT options, correct_answer, explanation, option_notes FROM questions WHERE question_text = $1', [item.q])).rows[0];
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
});
