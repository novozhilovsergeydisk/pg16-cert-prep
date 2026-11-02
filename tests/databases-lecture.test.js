const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const withLaterFixes = require('./later-fixes');
const source = require('../scripts/questions/129_databases_schemas_lecture').questions.map(withLaterFixes);
after(() => pool.end());

test('Раздел 08: одиннадцать вопросов по сверке с лекцией в экзаменационной теме, согласованы с исходником', async () => {
    for (const item of source) {
        const { rows } = await pool.query(
            'SELECT q.options, q.correct_answer, q.explanation, q.option_notes FROM questions q JOIN categories c ON c.id = q.category_id WHERE left(c.name, 3) = $1 AND c.in_exam AND q.question_text = $2',
            [item.t + '.', item.q]
        );
        assert.equal(rows.length, 1, 'Нужна миграция 129: ' + item.q.slice(0, 50));
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
});
