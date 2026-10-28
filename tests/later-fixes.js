// Накладывает более поздние исправления (054–056, 060–062, 064–099, 101) на вопрос из исходника набора: тесты сверяют базу с итоговым текстом,
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
    ...require('../scripts/questions/079_option_length_topic11').fixes,
    ...require('../scripts/questions/080_option_length_topic13').fixes,
    ...require('../scripts/questions/081_option_length_topic08').fixes,
    ...require('../scripts/questions/082_codex_topic11_fixes').fixes,
    ...require('../scripts/questions/083_codex_topic08_fixes').fixes,
    ...require('../scripts/questions/084_option_length_topic12').fixes,
    ...require('../scripts/questions/085_option_length_topic03').fixes,
    ...require('../scripts/questions/086_codex_topic12_fixes').fixes,
    ...require('../scripts/questions/087_option_length_topic01').fixes,
    ...require('../scripts/questions/088_option_length_topic17').fixes,
    ...require('../scripts/questions/089_codex_topic17_fixes').fixes,
    ...require('../scripts/questions/090_option_length_topic19').fixes,
    ...require('../scripts/questions/091_codex_topic19_fixes').fixes,
    ...require('../scripts/questions/092_codex_topic04_fixes').fixes,
    ...require('../scripts/questions/093_codex_topic05_fixes').fixes,
    ...require('../scripts/questions/094_codex_topic06_fixes').fixes,
    ...require('../scripts/questions/095_codex_topic14_fixes').fixes,
    ...require('../scripts/questions/096_codex_topic15_fixes').fixes,
    ...require('../scripts/questions/097_codex_topic03_fixes').fixes,
    ...require('../scripts/questions/098_codex_topic16_fixes').fixes,
    ...require('../scripts/questions/099_codex_topic13_fixes').fixes,
    ...require('../scripts/questions/101_codex_topic01_fixes').fixes,
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
