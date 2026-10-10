// Сравнение результатов проверки Codex с ключами и файл для вычитки.
//
//   node scripts/codex-compare.js <каталог проверки> [--fixed 3,27] [--per-topic 3]
//
// Читает <каталог>/keys.json, <каталог>/questions.json и <каталог>/work/out/{blind,notes}.txt.
// Пишет <каталог>/report.md (расхождения, спорные, замечания к пояснениям)
// и <каталог>/review.md (исправленные вопросы и выборка по темам для пользователя).
const fs = require('fs');
const path = require('path');

const [dir, ...rest] = process.argv.slice(2);
if (!dir) {
    console.error('Использование: node scripts/codex-compare.js <каталог> [--fixed 3,27] [--per-topic 3]');
    process.exit(1);
}
const arg = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const fixed = (arg('--fixed') || '').split(',').filter(Boolean).map(Number);
const perTopic = Number(arg('--per-topic') || 3);

const keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8'));
const qs = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
const byId = Object.fromEntries(qs.map((x) => [x.id, x]));
const parse = (f) => {
    if (!fs.existsSync(f)) return null;
    const t = fs.readFileSync(f, 'utf8').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']') + 1));
};
const blind = parse(path.join(dir, 'work', 'out', 'blind.txt')) || [];
const notes = parse(path.join(dir, 'work', 'out', 'notes.txt')) || [];
const num = (id) => id - 1000;

const differ = [], flagged = [];
for (const a of blind) {
    const mine = String(a.answer || '').split('').sort().join('');
    if (mine !== keys[a.id]) differ.push(a);
    else if (a.flag) flagged.push(a);
}
console.log(`слепая проверка: ответов ${blind.length} из ${qs.length}, совпало ${blind.length - differ.length}, расхождений ${differ.length}, спорных ${flagged.length}`);
console.log(`замечаний к пояснениям: ${notes.length} (в вопросах: ${[...new Set(notes.map((n) => num(n.id)))].join(',') || 'нет'})`);
if (differ.length) console.log('расхождения: ' + differ.map((a) => num(a.id)).join(','));
if (flagged.length) console.log('спорные: ' + flagged.map((a) => num(a.id)).join(','));

const kind = { single: 'один ответ', multi: 'несколько ответов', code: 'дополните код' };
const show = (id, level = '###') => {
    const x = byId[id];
    let s = `${level} ${num(id)}. Тема ${x.t}, ${kind[x.kind]}\n\n${x.q}\n\n`;
    for (const [l, t] of Object.entries(x.options)) s += `- **${l}.** ${t}${x.correct.includes(l) ? ' ✔' : ''}  \n  _${x.notes[l]}_\n`;
    return s + `\nПояснение к вопросу: ${x.e}\n\n`;
};

let report = '# Результаты проверки Codex\n\n';
report += `## Расхождения с ключом (${differ.length})\n\n` + (differ.map((a) => show(a.id) + `Codex: ${a.answer} (${a.confidence}). ${a.note || ''}\n`).join('\n') || 'нет\n');
report += `\n## Ответ совпал, но вопрос помечен спорным (${flagged.length})\n\n` + (flagged.map((a) => show(a.id) + `Замечание: ${a.note}\n`).join('\n') || 'нет\n');
report += `\n## Замечания к пояснениям (${notes.length})\n\n` + (notes.map((n) => `- **${num(n.id)}${n.letter === 'Q' ? ' (вопрос)' : '.' + n.letter}**: ${n.problem}\n  Предложение: ${n.fix}\n  Источник: ${n.source}`).join('\n') || 'нет\n');
fs.writeFileSync(path.join(dir, 'report.md'), report);

const topics = [...new Set(qs.map((x) => x.t))].sort();
let review = `# Новые вопросы тем ${topics[0]}–${topics[topics.length - 1]}: вычитка\n\n✔ отмечает правильный вариант, под каждым вариантом — его пояснение. На странице варианты перемешиваются.\n\n`;
if (fixed.length) review += `## Часть 1. Были спорными, исправлены по замечаниям (${fixed.length})\n\n` + fixed.map((n) => show(1000 + n)).join('');
review += `## ${fixed.length ? 'Часть 2. ' : ''}Выборка по темам (по ${perTopic})\n\n`;
for (const t of topics) {
    const pool = qs.filter((x) => x.t === t && !fixed.includes(num(x.id)));
    const pick = [];
    for (const k of ['single', 'multi', 'code']) { const q = pool.find((x) => x.kind === k && !pick.includes(x)); if (q) pick.push(q); }
    for (const q of pool) if (pick.length < perTopic && !pick.includes(q)) pick.push(q);
    review += `### Тема ${t}\n\n` + pick.slice(0, perTopic).map((x) => show(x.id, '####')).join('');
}
fs.writeFileSync(path.join(dir, 'review.md'), review);
console.log(`отчёт: ${path.join(dir, 'report.md')}; вычитка: ${path.join(dir, 'review.md')}`);
