// Генератор миграции с новыми вопросами и материалов для независимой проверки.
//
//   node scripts/gen-questions.js scripts/questions/<файл>.js [--export <каталог вне проекта>]
//
// Пишет migrations/<migration>.sql. С --export дополнительно создаёт:
//   <каталог>/work/batch.json  — вопросы без ключей и пояснений (для слепой проверки);
//   <каталог>/work/notes.json  — вопросы с ключами и пояснениями (для проверки пояснений);
//   <каталог>/keys.json, <каталог>/questions.json — ключи и полные данные (вне рабочей папки проверяющего).
const fs = require('fs');
const path = require('path');

const [dataFile, ...rest] = process.argv.slice(2);
if (!dataFile) {
    console.error('Использование: node scripts/gen-questions.js scripts/questions/<файл>.js [--export <каталог>]');
    process.exit(1);
}
const exportIdx = rest.indexOf('--export');
const exportDir = exportIdx >= 0 ? rest[exportIdx + 1] : null;

const data = require(path.resolve(dataFile));
const Q = data.questions;
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const topics = Object.keys(data.target).sort();

// Проверки данных
const cnt = {};
for (const x of Q) {
    cnt[x.t] = (cnt[x.t] || 0) + 1;
    if (![4, 5].includes(x.opts.length)) throw new Error('нужно 4 или 5 вариантов: ' + x.q);
    if (new Set(x.opts.map((o) => o[0])).size !== x.opts.length) throw new Error('повтор вариантов: ' + x.q);
    const ok = x.opts.filter((o) => o[1]).length;
    if (x.kind === 'multi' ? ok < 2 : ok !== 1) throw new Error('число верных: ' + x.q);
    if (x.kind === 'code' && !x.q.includes('___')) throw new Error('нет пропуска: ' + x.q);
    for (const o of x.opts) if (!o[2] || /`/.test(o[2])) throw new Error('пояснение пусто или с обратной кавычкой: ' + x.q);
    if (/`/.test(x.e)) throw new Error('обратная кавычка в пояснении: ' + x.q);
}
for (const t of topics) if (cnt[t] !== data.target[t]) throw new Error(`тема ${t}: ${cnt[t]} вместо ${data.target[t]}`);
if (new Set(Q.map((x) => x.q)).size !== Q.length) throw new Error('повтор текста вопроса');

// Детерминированное перемешивание вариантов
let seed = data.seed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const out = Q.map((x) => {
    const opts = x.opts.slice();
    for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const options = {}, notes = {}, correct = [];
    opts.forEach(([text, ok, note], i) => {
        options[LETTERS[i]] = text;
        notes[LETTERS[i]] = note;
        if (ok) correct.push(LETTERS[i]);
    });
    return { ...x, options, notes, correct: correct.join('') };
});

// Миграция
const rows = out.map((x) =>
    `SELECT (SELECT id FROM categories WHERE left(name, 3) = ${lit(x.t + '.')}), ${lit(x.q)}, ${lit(JSON.stringify(x.options))}::jsonb, ${lit(x.correct)}, ${lit(x.e)}, ${lit(JSON.stringify(x.notes))}::jsonb`
);
const topicList = topics.map((t) => `'${t}.'`).join(', ');
let sql = `-- ${data.header}\n`;
sql += '-- Повторный запуск безопасен: вопрос с тем же текстом не добавляется второй раз.\n\nBEGIN;\n\n';
sql += 'INSERT INTO questions (category_id, question_text, options, correct_answer, explanation, option_notes)\n';
sql += 'SELECT n.* FROM (\n' + rows.map((r) => '    ' + r).join('\n    UNION ALL\n') + '\n) AS n(category_id, question_text, options, correct_answer, explanation, option_notes)\n';
sql += 'WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);\n\n';
sql += `DO $check$\nDECLARE n integer;\nBEGIN\n    SELECT count(*) INTO n FROM questions WHERE option_notes IS NOT NULL AND category_id IN (SELECT id FROM categories WHERE left(name, 3) IN (${topicList}));\n`;
sql += `    IF n < ${Q.length} THEN\n        RAISE EXCEPTION 'Ожидалось не меньше ${Q.length} вопросов с пояснениями в темах ${topics[0]}–${topics[topics.length - 1]}, найдено %', n;\n    END IF;\nEND\n$check$;\n\nCOMMIT;\n`;
const migrationPath = path.join(__dirname, '..', 'migrations', data.migration + '.sql');
if (data.strictInsert) {
    const sources = [...new Set([...Q.flatMap((q) => q.sources || []), ...(data.updateSources || [])])];
    const updates = data.explanationUpdates || [];
    if (new Set(updates.map((x) => x.t + ':' + x.q)).size !== updates.length) throw new Error('повтор исправляемого вопроса');
    const updateRows = updates.map((x) => {
        const keys = Object.keys(x.options);
        if (!/^\d{2}$/.test(x.t) || !x.q || !x.oldExplanation || !x.e || /`/.test(x.e)
            || !/^[A-E]+$/.test(x.correct) || ![...x.correct].every((key) => keys.includes(key))
            || [x.oldNotes, x.notes].some((notes) => Object.keys(notes).sort().join('') !== keys.slice().sort().join('')
                || Object.values(notes).some((note) => !note || /`/.test(note)))) {
            throw new Error('неверное описание исправления пояснений');
        }
        return `        (${[x.t + '.', x.q, JSON.stringify(x.options), x.correct, x.oldExplanation,
            JSON.stringify(x.oldNotes), x.e, JSON.stringify(x.notes)].map(lit).join(', ')})`;
    });
    const updateSql = updates.length ? `DO $notes$
DECLARE fix record; matches integer;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
${updateRows.join(',\n')}
    ) AS fixes(topic, question_text, options, correct_answer, old_explanation, old_notes, explanation, notes)
    LOOP
        SELECT count(*) INTO matches FROM questions q JOIN categories c ON c.id = q.category_id
        WHERE left(c.name, 3) = fix.topic AND q.question_text = fix.question_text;
        IF matches <> 1 OR NOT EXISTS (
            SELECT 1 FROM questions q JOIN categories c ON c.id = q.category_id
            WHERE left(c.name, 3) = fix.topic AND q.question_text = fix.question_text
              AND q.options = fix.options::jsonb AND q.correct_answer = fix.correct_answer
              AND ((q.explanation = fix.old_explanation AND q.option_notes = fix.old_notes::jsonb)
                OR (q.explanation = fix.explanation AND q.option_notes = fix.notes::jsonb))
        ) THEN
            RAISE EXCEPTION 'Не найден единственный вопрос с ожидаемыми ключами и пояснениями';
        END IF;
        UPDATE questions q SET explanation = fix.explanation, option_notes = fix.notes::jsonb
        FROM categories c WHERE c.id = q.category_id AND left(c.name, 3) = fix.topic
          AND q.question_text = fix.question_text
          AND (q.explanation IS DISTINCT FROM fix.explanation OR q.option_notes IS DISTINCT FROM fix.notes::jsonb);
    END LOOP;
END
$notes$;

` : '';
    sql = `-- ${data.header}
-- Источник: ${path.relative(path.join(__dirname, '..'), path.resolve(dataFile))}
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
${sources.map((url) => '-- ' + url).join('\n')}

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

${updateSql}CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
${rows.join('\nUNION ALL\n')};

DO $check$
DECLARE candidate record; matches integer;
BEGIN
    FOR candidate IN SELECT * FROM question_seed LOOP
        SELECT count(*) INTO matches FROM questions q
        WHERE regexp_replace(trim(q.question_text), '[[:space:]]+', ' ', 'g') =
              regexp_replace(trim(candidate.question_text), '[[:space:]]+', ' ', 'g');
        IF matches > 1 OR (matches = 1 AND NOT EXISTS (
            SELECT 1 FROM questions q WHERE q.question_text = candidate.question_text
              AND q.category_id = candidate.category_id AND q.options = candidate.options
              AND q.correct_answer = candidate.correct_answer AND q.explanation = candidate.explanation
              AND q.option_notes = candidate.option_notes
        )) THEN
            RAISE EXCEPTION 'Конфликт содержимого или повтор нового вопроса';
        END IF;
    END LOOP;
END
$check$;

INSERT INTO questions(category_id, question_text, options, correct_answer, explanation, option_notes)
SELECT n.* FROM question_seed n
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);

DO $check$
BEGIN
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> ${Q.length} THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
`;
}
fs.writeFileSync(migrationPath, sql);

const dist = {};
out.forEach((x) => x.correct.split('').forEach((l) => (dist[l] = (dist[l] || 0) + 1)));
console.log(`миграция: migrations/${data.migration}.sql; вопросов: ${Q.length} ${JSON.stringify(cnt)}; буквы верных: ${JSON.stringify(dist)}`);

// Материалы для проверки Codex
if (exportDir) {
    const projectRoot = path.resolve(__dirname, '..');
    const abs = path.resolve(exportDir);
    if (abs === projectRoot || abs.startsWith(projectRoot + path.sep)) {
        throw new Error('Каталог для проверки должен быть вне проекта: проверяющий не должен видеть .env и ключи');
    }
    fs.mkdirSync(path.join(abs, 'work'), { recursive: true });
    const id = (i) => 1001 + i;
    fs.writeFileSync(path.join(abs, 'work', 'batch.json'), JSON.stringify(out.map((x, i) =>
        ({ id: id(i), topic: x.t, choose: x.correct.length, question: x.q, options: x.options })), null, 1));
    fs.writeFileSync(path.join(abs, 'work', 'notes.json'), JSON.stringify(out.map((x, i) =>
        ({ id: id(i), topic: x.t, question: x.q, options: x.options, correct: x.correct, option_notes: x.notes })), null, 1));
    fs.writeFileSync(path.join(abs, 'keys.json'), JSON.stringify(Object.fromEntries(out.map((x, i) => [id(i), x.correct]))));
    fs.writeFileSync(path.join(abs, 'questions.json'), JSON.stringify(out.map((x, i) => ({ id: id(i), ...x })), null, 1));
    console.log(`материалы для проверки: ${abs}/work (без ключей в batch.json), ключи: ${abs}/keys.json`);
}
