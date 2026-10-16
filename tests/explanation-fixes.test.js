const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { fixes } = require('../scripts/questions/033_explanation_fixes');
const sql = fs.readFileSync(path.join(__dirname, '../migrations/033_explanation_fixes.sql'), 'utf8');
after(() => pool.end());

test('Исправления пояснений: все новые тексты в базе, прежних нет, ключи не тронуты', async () => {
    assert.equal(fixes.length, 50);
    assert.equal(new Set(fixes.map((fix) => fix.q)).size, 45);
    for (const fix of fixes) {
        const { rows } = await pool.query('SELECT explanation, option_notes, options, correct_answer FROM questions WHERE question_text = $1', [fix.q]);
        assert.equal(rows.length, 1, 'Нужна миграция 033');
        const current = fix.field === 'explanation' ? rows[0].explanation : rows[0].option_notes[fix.field];
        assert.equal(current, fix.new);
        assert.notEqual(current, fix.old);
        assert.deepEqual(Object.keys(rows[0].option_notes).sort(), Object.keys(rows[0].options).sort());
        assert.ok([...rows[0].correct_answer].every((key) => key in rows[0].options));
    }
});

test('Исправления пояснений: миграция сверяет прежний текст и не меняет ключи и варианты', () => {
    assert.match(sql, /^BEGIN;/m);
    assert.match(sql, /COMMIT;\s*$/);
    assert.match(sql, /RAISE EXCEPTION/);
    assert.ok(!/correct_answer|options\s*=/.test(sql.replace(/AND question_text[^\n]*/g, '')), 'Миграция не должна менять варианты и ключи');
    for (const fix of fixes) assert.ok(sql.includes(fix.new.replace(/'/g, "''")), 'В миграции нет нового текста: ' + fix.new.slice(0, 40));
});
