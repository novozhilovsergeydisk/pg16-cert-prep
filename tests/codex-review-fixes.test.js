const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { fixes } = require('../scripts/questions/060_codex_review_fixes');
after(() => pool.end());

// Ключи этих вопросов на момент проверки Codex: исправления 060 меняют только пояснения.
const keys = {
    'Где хранятся в памяти последние страницы clog?': 'A',
    'Что произойдёт, если не выполнять заморозку своевременно?': 'A',
    'Чем системный вызов fdatasync отличается от fsync?': 'A',
    'Чем потоковый архив журналов, который ведёт pg_receivewal, отличается от файлового?': 'A',
    'Из чего создают физическую реплику?': 'A',
};

test('Исправления 060: новые пояснения в базе, прежних нет, ключи и варианты не тронуты', async () => {
    assert.equal(fixes.length, 5);
    assert.deepEqual(fixes.map((f) => f.q).sort(), Object.keys(keys).sort());
    for (const f of fixes) {
        const { rows } = await pool.query(
            'SELECT options, correct_answer, explanation, option_notes FROM questions WHERE question_text = $1', [f.q]);
        assert.equal(rows.length, 1, 'Нужна миграция 060: ' + f.q.slice(0, 50));
        const q = rows[0];
        assert.equal(q.correct_answer, keys[f.q], 'Ключ изменился: ' + f.q.slice(0, 50));
        assert.equal(Object.keys(q.options).length, 4);
        if (f.kind === 'explanation') {
            assert.equal(q.explanation, f.new);
        } else {
            const key = Object.keys(q.options).find((k) => q.options[k] === f.opt);
            assert.ok(key, 'нет варианта: ' + f.opt.slice(0, 50));
            assert.equal(q.option_notes[key], f.newNote);
            assert.ok(!Object.values(q.option_notes).includes(f.oldNote));
        }
    }
});
