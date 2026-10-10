// Тексты слайдов курса DBA1 для проверки вопросов.
//
//   node scripts/extract-course-text.js <каталог-назначения>
//
// Темы 01–03 берутся из materials/pdftext, остальные извлекаются из materials/handouts/*.html
// (pdf2htmlEX: строки склеиваются, теги удаляются). Материалы курса в репозиторий не входят.
const fs = require('fs');
const path = require('path');

const dst = process.argv[2];
if (!dst) {
    console.error('Использование: node scripts/extract-course-text.js <каталог-назначения>');
    process.exit(1);
}
const root = path.join(__dirname, '..', 'materials');
fs.mkdirSync(dst, { recursive: true });

const ent = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
function htmlToText(html) {
    let h = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<img[^>]*>/gi, '');
    h = h.replace(/<div class="pf[^"]*"[^>]*>/g, '\n=== page ===\n').replace(/<\/div>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
    h = h.replace(/&(nbsp|lt|gt|amp|quot|#39|apos);/g, (m) => ent[m]);
    const lines = h.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && !/^Slide \d+$/.test(s));
    const start = lines.findIndex((s) => s.startsWith('Темы'));
    return lines.slice(start > 0 ? start : 0).join('\n');
}

let count = 0;
const pdftext = path.join(root, 'pdftext');
const fromPdf = new Set();
if (fs.existsSync(pdftext)) {
    for (const f of fs.readdirSync(pdftext).filter((f) => /^dba1_\d\d_.*\.txt$/.test(f))) {
        fs.copyFileSync(path.join(pdftext, f), path.join(dst, f));
        fromPdf.add(f.slice(0, 7));
        count++;
    }
}
const handouts = path.join(root, 'handouts');
for (const f of fs.readdirSync(handouts).filter((f) => /^dba1_(\d\d)_.*\.html$/.test(f))) {
    if (f.startsWith('dba1_00') || fromPdf.has(f.slice(0, 7))) continue;
    fs.writeFileSync(path.join(dst, f.replace(/\.html$/, '.txt')), htmlToText(fs.readFileSync(path.join(handouts, f), 'utf8')));
    count++;
}
console.log(`тексты тем: ${count} файлов в ${dst}`);
