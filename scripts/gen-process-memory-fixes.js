// Генерация migrations/036_process_memory_fixes.sql из scripts/questions/036_process_memory_fixes.js.
// Запуск: node scripts/gen-process-memory-fixes.js
const fs = require('fs');
const path = require('path');

// Без аргумента — исправления раздела 18 (036); иначе имя файла данных в scripts/questions без .js, например 039_explanation_style.
const dataFile = path.join(__dirname, 'questions', (process.argv[2] || '036_process_memory_fixes') + '.js');
const data = require(dataFile);
const lit = (text) => (text === undefined || text === null ? 'NULL' : "'" + String(text).replace(/'/g, "''") + "'");

for (const fix of data.fixes) {
    const ok = {
        question: fix.q && fix.new && fix.q !== fix.new,
        explanation: fix.q && fix.old && fix.new && fix.old !== fix.new,
        option: fix.q && fix.opt && (fix.newOpt || fix.newNote) && (!fix.newNote || (fix.oldNote && fix.oldNote !== fix.newNote)),
        key: fix.q && /^[A-E]+$/.test(fix.old || '') && /^[A-E]+$/.test(fix.new || '') && fix.old !== fix.new,
    }[fix.kind];
    if (!ok) throw new Error('неверное описание исправления: ' + JSON.stringify(fix).slice(0, 80));
}

const changesKeys = data.fixes.some((fix) => fix.kind === 'key');

// kind, question_text, opt_text, new_opt_text, old_text, new_text
const rows = data.fixes.map((fix) => `        (${[
    fix.kind, fix.q, fix.opt, fix.newOpt, fix.kind === 'option' ? fix.oldNote : fix.old, fix.kind === 'option' ? fix.newNote : fix.new,
].map(lit).join(', ')})`);

const sql = `-- ${data.header}
-- Источник: ${path.relative(path.join(__dirname, '..'), dataFile)}
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. ${changesKeys
        ? 'Ключ ответа меняется только правкой вида key, прежний ключ проверяется; число и порядок вариантов не меняются.'
        : 'Ключи ответов, число и порядок вариантов не меняются.'}

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
${rows.join(',\n')}
    ) AS fixes(kind, question_text, opt_text, new_opt_text, old_text, new_text)
    LOOP
        -- Сначала ровно один вопрос по тексту (прежнему или новому), дальше всё только по его id.
        SELECT count(*), min(id) INTO matches, qid FROM questions
        WHERE question_text IN (fix.question_text, CASE WHEN fix.kind = 'question' THEN fix.new_text ELSE fix.question_text END);
        IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вопрос для исправления'; END IF;
        IF fix.kind = 'question' THEN
            UPDATE questions SET question_text = fix.new_text WHERE id = qid;
        ELSIF fix.kind = 'explanation' THEN
            PERFORM 1 FROM questions WHERE id = qid AND explanation IN (fix.old_text, fix.new_text);
            IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение вопроса'; END IF;
            UPDATE questions SET explanation = fix.new_text WHERE id = qid;${changesKeys ? `
        ELSIF fix.kind = 'key' THEN
            PERFORM 1 FROM questions WHERE id = qid AND correct_answer IN (fix.old_text, fix.new_text);
            IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданный ключ ответа'; END IF;
            UPDATE questions SET correct_answer = fix.new_text WHERE id = qid;` : ''}
        ELSE
            SELECT count(*), min(o.key) INTO matches, k
            FROM questions q, jsonb_each_text(q.options) o
            WHERE q.id = qid AND o.value IN (fix.opt_text, coalesce(fix.new_opt_text, fix.opt_text));
            IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вариант ответа для исправления'; END IF;
            IF fix.new_text IS NOT NULL THEN
                PERFORM 1 FROM questions WHERE id = qid AND option_notes ->> k IN (fix.old_text, fix.new_text);
                IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение варианта'; END IF;
                UPDATE questions SET option_notes = jsonb_set(option_notes, ARRAY[k], to_jsonb(fix.new_text)) WHERE id = qid;
            END IF;
            IF fix.new_opt_text IS NOT NULL THEN
                UPDATE questions SET options = jsonb_set(options, ARRAY[k], to_jsonb(fix.new_opt_text)) WHERE id = qid;
            END IF;
        END IF;
    END LOOP;
END
$fix$;

COMMIT;
`;
fs.writeFileSync(path.join(__dirname, '..', 'migrations', data.migration + '.sql'), sql);
console.log('миграция: migrations/' + data.migration + '.sql; исправлений: ' + data.fixes.length);
