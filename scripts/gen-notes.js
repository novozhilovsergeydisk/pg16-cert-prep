// Генератор миграции с пояснениями к вариантам для прежних вопросов (у которых option_notes пустое).
//
//   node scripts/gen-notes.js scripts/notes/<файл>.js [--export <каталог вне проекта>]
//
// Файл данных задаёт для каждого вопроса первую строку текста, верные буквы и пояснения по буквам.
// Генератор находит вопрос в базе из .env по первой строке среди вопросов без пояснений,
// сверяет верные буквы и набор вариантов и пишет migrations/<migration>.sql.
// Миграция ищет вопросы по полному тексту (номера в базах мака и сервера различаются)
// и заполняет только пустые option_notes, поэтому повторный запуск безопасен.
// С --export дополнительно создаёт материалы для scripts/codex-check.sh и scripts/codex-compare.js.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const pool = require('../src/config/db');

const [dataFile, ...rest] = process.argv.slice(2);
if (!dataFile) {
    console.error('Использование: node scripts/gen-notes.js scripts/notes/<файл>.js [--export <каталог>]');
    process.exit(1);
}
const exportIdx = rest.indexOf('--export');
const exportDir = exportIdx >= 0 ? rest[exportIdx + 1] : null;
const data = require(path.resolve(dataFile));
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const firstLine = (text) => text.split('\n')[0];

async function main() {
    const db = await pool.query(
        `SELECT left(c.name, 2) AS t, q.question_text, q.options, q.correct_answer, q.explanation
         FROM questions q JOIN categories c ON c.id = q.category_id
         WHERE q.option_notes IS NULL AND left(c.name, 2) = ANY($1)
         ORDER BY c.name, q.id`,
        [data.topics]
    );
    const byLine = new Map();
    for (const row of db.rows) {
        const key = firstLine(row.question_text);
        if (byLine.has(key)) throw new Error('первая строка не уникальна среди вопросов без пояснений: ' + key);
        byLine.set(key, row);
    }

    const used = new Set();
    const out = data.notes.map((n) => {
        const row = byLine.get(n.line);
        if (!row) throw new Error('вопрос не найден среди вопросов без пояснений: ' + n.line);
        if (used.has(n.line)) throw new Error('пояснения к вопросу заданы дважды: ' + n.line);
        used.add(n.line);
        if (row.correct_answer !== n.correct) throw new Error(`верные буквы ${n.correct} не совпадают с базой (${row.correct_answer}): ${n.line}`);
        const letters = Object.keys(row.options).sort().join('');
        if (Object.keys(n.notes).sort().join('') !== letters) throw new Error('набор букв пояснений не совпадает с вариантами: ' + n.line);
        for (const [l, text] of Object.entries(n.notes)) {
            if (typeof text !== 'string' || text.trim() === '' || /`/.test(text)) throw new Error(`пояснение ${l} пусто или с обратной кавычкой: ${n.line}`);
        }
        return { ...row, notes: n.notes };
    });
    const missing = db.rows.filter((r) => !used.has(firstLine(r.question_text)));
    if (missing.length) throw new Error('нет пояснений для вопросов:\n' + missing.map((r) => '  ' + firstLine(r.question_text)).join('\n'));

    const topicList = data.topics.map((t) => `'${t}.'`).join(', ');
    let sql = `-- ${data.header}\n`;
    sql += '-- Вопросы ищутся по полному тексту; заполняются только пустые option_notes, повторный запуск безопасен.\n\nBEGIN;\n\n';
    if (out.length) {
        sql += 'UPDATE questions q SET option_notes = n.notes::jsonb\nFROM (VALUES\n';
        sql += out.map((x) => `    (${lit(x.question_text)}, ${lit(JSON.stringify(x.notes))})`).join(',\n');
        sql += '\n) AS n(question_text, notes)\nWHERE q.question_text = n.question_text AND q.option_notes IS NULL;\n\n';
    }
    // Исправления уже записанных пояснений: меняются только названные буквы, остальные остаются. Повторный запуск безопасен.
    for (const fix of data.fixes || []) {
        const found = await pool.query(
            `SELECT q.question_text, q.options FROM questions q
             WHERE split_part(q.question_text, E'\n', 1) = $1 AND left((SELECT name FROM categories WHERE id = q.category_id), 2) = ANY($2)`,
            [fix.line, data.topics]
        );
        if (found.rowCount !== 1) throw new Error('для исправления нужен ровно один вопрос, найдено ' + found.rowCount + ': ' + fix.line);
        const row = found.rows[0];
        for (const [l, text] of Object.entries(fix.letters)) {
            if (!row.options[l]) throw new Error(`нет варианта ${l}: ${fix.line}`);
            if (typeof text !== 'string' || text.trim() === '' || /`/.test(text)) throw new Error(`пояснение ${l} пусто или с обратной кавычкой: ${fix.line}`);
        }
        sql += `UPDATE questions SET option_notes = option_notes || ${lit(JSON.stringify(fix.letters))}::jsonb WHERE question_text = ${lit(row.question_text)} AND option_notes IS NOT NULL;\n`;
    }
    if ((data.fixes || []).length) sql += '\n';
    sql += `DO $check$\nDECLARE n integer;\nBEGIN\n    SELECT count(*) INTO n FROM questions WHERE option_notes IS NULL AND category_id IN (SELECT id FROM categories WHERE left(name, 3) IN (${topicList}));\n`;
    sql += `    IF n > 0 THEN\n        RAISE EXCEPTION 'В темах ${data.topics[0]}–${data.topics[data.topics.length - 1]} остались вопросы без пояснений к вариантам: %', n;\n    END IF;\nEND\n$check$;\n\nCOMMIT;\n`;
    fs.writeFileSync(path.join(__dirname, '..', 'migrations', data.migration + '.sql'), sql);
    const perTopic = {};
    out.forEach((x) => { perTopic[x.t] = (perTopic[x.t] || 0) + 1; });
    console.log(`миграция: migrations/${data.migration}.sql; вопросов: ${out.length} ${JSON.stringify(perTopic)}`);

    if (exportDir) {
        const projectRoot = path.resolve(__dirname, '..');
        const abs = path.resolve(exportDir);
        if (abs === projectRoot || abs.startsWith(projectRoot + path.sep)) {
            throw new Error('Каталог для проверки должен быть вне проекта: проверяющий не должен видеть .env и ключи');
        }
        fs.mkdirSync(path.join(abs, 'work'), { recursive: true });
        const id = (i) => 1001 + i;
        const kind = (x) => (x.question_text.includes('___') ? 'code' : x.correct_answer.length > 1 ? 'multi' : 'single');
        fs.writeFileSync(path.join(abs, 'work', 'batch.json'), JSON.stringify(out.map((x, i) =>
            ({ id: id(i), topic: x.t, choose: x.correct_answer.length, question: x.question_text, options: x.options })), null, 1));
        fs.writeFileSync(path.join(abs, 'work', 'notes.json'), JSON.stringify(out.map((x, i) =>
            ({ id: id(i), topic: x.t, question: x.question_text, options: x.options, correct: x.correct_answer, option_notes: x.notes })), null, 1));
        fs.writeFileSync(path.join(abs, 'keys.json'), JSON.stringify(Object.fromEntries(out.map((x, i) => [id(i), x.correct_answer]))));
        fs.writeFileSync(path.join(abs, 'questions.json'), JSON.stringify(out.map((x, i) => ({
            id: id(i), t: x.t, kind: kind(x), q: x.question_text, options: x.options, notes: x.notes, correct: x.correct_answer, e: x.explanation,
        })), null, 1));
        console.log(`материалы для проверки: ${abs}/work`);
    }
}

main().then(() => pool.end(), (err) => {
    // Свои ошибки проверки выводятся полностью; у ошибок базы — только код (в тексте может быть адрес и пользователь).
    console.error(err && err.code ? 'Ошибка базы данных, код ' + err.code : 'Ошибка: ' + (err && err.message));
    pool.end();
    process.exit(1);
});
