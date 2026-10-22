// Накладывает более поздние исправления (054, 055) на вопрос из исходника набора: тесты сверяют базу с итоговым текстом,
// а уже выложенные миграции наборов остаются неизменными.
const later = [
    ...require('../scripts/questions/054_sections_review_fixes').fixes,
    ...require('../scripts/questions/055_pgoptions_export').fixes,
];

module.exports = function withLaterFixes(item) {
    let q = item.q;
    let e = item.e;
    const opts = item.opts.map(([text, ok, note]) => [text, ok, note]);
    for (const f of later) {
        if (f.kind === 'question' && f.q === q) q = f.new;
    }
    for (const f of later) {
        if (f.q !== q) continue;
        if (f.kind === 'explanation' && e === f.old) e = f.new;
        if (f.kind === 'option') {
            const opt = opts.find((o) => o[0] === f.opt);
            if (!opt) continue;
            if (f.newNote && opt[2] === f.oldNote) opt[2] = f.newNote;
            if (f.newOpt) opt[0] = f.newOpt;
        }
    }
    return { ...item, q, e, opts };
};
