const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { fixes } = require('../scripts/questions/060_codex_review_fixes');
const { later } = require('./later-fixes');
after(() => pool.end());

// Ключи этих вопросов на момент проверки Codex: исправления 060 меняют только пояснения.
// Поздние правки (например, 126) могут переименовать вопрос, сменить ключ или пояснение: итог берётся по цепочке later.
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
        let name = f.q;
        let key = keys[f.q];
        let explanation = f.new;
        for (const g of later) {
            if (g.q !== name) continue;
            if (g.kind === 'question') name = g.new;
            else if (g.kind === 'key' && g.old === key) key = g.new;
            else if (g.kind === 'explanation' && f.kind === 'explanation' && g.old === explanation) explanation = g.new;
        }
        const { rows } = await pool.query(
            'SELECT options, correct_answer, explanation, option_notes FROM questions WHERE question_text = $1', [name]);
        assert.equal(rows.length, 1, 'Нужна миграция 060: ' + f.q.slice(0, 50));
        const q = rows[0];
        assert.equal(q.correct_answer, key, 'Ключ изменился: ' + f.q.slice(0, 50));
        assert.equal(Object.keys(q.options).length, 4);
        if (f.kind === 'explanation') {
            assert.equal(q.explanation, explanation);
        } else {
            // Поздние правки (например, 065) могли переписать сам вариант или его пояснение: идём по цепочке.
            let text = f.opt;
            let note = f.newNote;
            for (const g of later) {
                if (g.kind === 'option' && g.q === f.q && g.opt === text) {
                    text = g.newOpt || text;
                    note = g.newNote || note;
                }
            }
            const key = Object.keys(q.options).find((k) => q.options[k] === text);
            assert.ok(key, 'нет варианта: ' + text.slice(0, 50));
            assert.equal(q.option_notes[key], note);
            assert.ok(!Object.values(q.option_notes).includes(f.oldNote));
        }
    }
});
