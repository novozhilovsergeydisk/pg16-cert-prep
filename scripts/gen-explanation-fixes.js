// Генерация migrations/033_explanation_fixes.sql из scripts/questions/033_explanation_fixes.js.
// Запуск: node scripts/gen-explanation-fixes.js
const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, 'questions', '033_explanation_fixes.js');
const data = require(dataFile);
const lit = (text) => "'" + text.replace(/'/g, "''") + "'";

const seen = new Set();
for (const fix of data.fixes) {
    const key = fix.q + '\n' + fix.field;
    if (seen.has(key)) throw new Error('повтор исправления: ' + fix.field + ' ' + fix.q.slice(0, 40));
    seen.add(key);
    if (!/^(explanation|[A-E])$/.test(fix.field) || !fix.old || !fix.new || fix.old === fix.new) {
        throw new Error('неверное описание исправления: ' + fix.q.slice(0, 40));
    }
}

const rows = data.fixes.map((fix) => `        (${[fix.q, fix.field, fix.old, fix.new].map(lit).join(', ')})`);
const sql = `-- ${data.header}
-- Источник: ${path.relative(path.join(__dirname, '..'), dataFile)}; таблица «было → станет»: docs/EXPLANATION-FIXES-2026-10-16.md
-- Повторный запуск безопасен: вопрос ищется по тексту, пояснение должно быть прежним или уже новым, иначе пакет отменяется.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
${rows.join(',\n')}
    ) AS fixes(question_text, field, old_text, new_text)
    LOOP
        IF fix.field = 'explanation' THEN
            SELECT count(*) INTO matches FROM questions
            WHERE question_text = fix.question_text AND explanation IN (fix.old_text, fix.new_text);
        ELSE
            SELECT count(*) INTO matches FROM questions
            WHERE question_text = fix.question_text AND option_notes ->> fix.field IN (fix.old_text, fix.new_text);
        END IF;
        IF matches <> 1 THEN
            RAISE EXCEPTION 'Не найден единственный вопрос с ожидаемым пояснением';
        END IF;
        IF fix.field = 'explanation' THEN
            UPDATE questions SET explanation = fix.new_text
            WHERE question_text = fix.question_text AND explanation = fix.old_text;
        ELSE
            UPDATE questions SET option_notes = jsonb_set(option_notes, ARRAY[fix.field], to_jsonb(fix.new_text))
            WHERE question_text = fix.question_text AND option_notes ->> fix.field = fix.old_text;
        END IF;
    END LOOP;
END
$fix$;

COMMIT;
`;
fs.writeFileSync(path.join(__dirname, '..', 'migrations', data.migration + '.sql'), sql);
console.log('миграция: migrations/' + data.migration + '.sql; исправлений: ' + data.fixes.length);
