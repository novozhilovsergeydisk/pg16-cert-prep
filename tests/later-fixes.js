// Накладывает более поздние исправления (054–056, 060–062, 064–078) на вопрос из исходника набора: тесты сверяют базу с итоговым текстом,
// а уже выложенные миграции наборов остаются неизменными.
const later = [
    ...require('../scripts/questions/054_sections_review_fixes').fixes,
    ...require('../scripts/questions/055_pgoptions_export').fixes,
    ...require('../scripts/questions/056_pending_restart').fixes,
    ...require('../scripts/questions/060_codex_review_fixes').fixes,
    ...require('../scripts/questions/061_option_length_topic20').fixes,
    ...require('../scripts/questions/062_option_length_topic18').fixes,
    ...require('../scripts/questions/064_codex_recheck_fixes').fixes,
    ...require('../scripts/questions/065_option_length_topic14').fixes,
    ...require('../scripts/questions/066_codex_recheck2_fixes').fixes,
    ...require('../scripts/questions/067_option_length_topic06').fixes,
    ...require('../scripts/questions/068_option_length_topic02').fixes,
    ...require('../scripts/questions/069_option_length_topic07').fixes,
    ...require('../scripts/questions/070_codex_topic02_fixes').fixes,
    ...require('../scripts/questions/071_codex_topic07_fixes').fixes,
    ...require('../scripts/questions/072_option_length_topic16').fixes,
    ...require('../scripts/questions/073_option_length_topic15').fixes,
    ...require('../scripts/questions/074_option_length_topic10').fixes,
    ...require('../scripts/questions/075_option_length_topic04').fixes,
    ...require('../scripts/questions/076_option_length_topic05').fixes,
    ...require('../scripts/questions/077_option_length_topic09').fixes,
    ...require('../scripts/questions/078_codex_topic10_fixes').fixes,
];

module.exports = function withLaterFixes(item) {
    let q = item.q;
    let e = item.e;
    const opts = item.opts.map(([text, ok, note]) => [text, ok, note]);
    // Исправления применяются по порядку: каждое видит вопрос под тем именем, какое он имел к этому моменту.
    for (const f of later) {
        if (f.kind === 'question' && f.q === q) { q = f.new; continue; }
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

// Все поздние исправления: тесты прежних миграций учитывают их при проверке итогового текста.
module.exports.later = later;
