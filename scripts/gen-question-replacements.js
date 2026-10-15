// Генератор миграции 029: обновление по разделу и старому/новому тексту, без привязки к ID.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { questions } = require('./questions/029_replace_semantic_duplicates');

function buildMigration() {
    assert.equal(questions.length, 16);
    assert.equal(new Set(questions.map((q) => q.oldQuestion)).size, 16);
    assert.equal(new Set(questions.map((q) => q.q)).size, 16);
    const lit = (text) => "'" + text.replace(/'/g, "''") + "'";
    const rows = questions.map((q, index) => {
        assert.match(q.t, /^\d{2}$/);
        assert.ok(q.oldQuestion && q.q && q.e && q.oldQuestion !== q.q);
        assert.equal(q.opts.length, 4);
        assert.equal(new Set(q.opts.map(([text]) => text)).size, 4);
        const count = q.opts.filter(([, correct]) => correct).length;
        assert.ok(q.kind === 'multi' ? count >= 2 && count < 4 : count === 1);
        if (q.kind === 'code') assert.ok(q.q.includes('___'));
        assert.ok(q.opts.every(([text, correct, note]) => text && typeof correct === 'boolean' && note && !note.includes('`')));
        assert.ok(!q.e.includes('`'));
        assert.match(q.source, /^https:\/\/www\.postgresql\.org\/docs\/16\//);
        // Воспроизводимое распределение правильных ответов по буквам.
        const opts = q.opts.map((_, i) => q.opts[(i + index) % 4]);
        const options = {}, notes = {}, correct = [];
        opts.forEach(([text, ok, note], i) => {
            const letter = 'ABCD'[i];
            options[letter] = text;
            notes[letter] = note;
            if (ok) correct.push(letter);
        });
        return `        -- Раздел ${q.t}: ${q.source}\n        (${[
            q.t + '.', q.oldQuestion, q.q, JSON.stringify(options), correct.join(''), q.e, JSON.stringify(notes),
        ].map(lit).join(',\n         ')})`;
    });
    return `-- Замена 16 смысловых повторов: ID, категории и история сохраняются.
-- Источник: scripts/questions/029_replace_semantic_duplicates.js
-- Пересборка: node scripts/gen-question-replacements.js
-- Повторный запуск безопасен. При отсутствии/неоднозначности вопроса отменяется весь пакет.

BEGIN;
SET LOCAL standard_conforming_strings = on;

DO $replace$
DECLARE
    replacement record;
    changed integer;
BEGIN
    FOR replacement IN
        SELECT * FROM (VALUES
${rows.join(',\n')}
        ) AS replacements(topic, old_text, new_text, options, correct_answer, explanation, option_notes)
    LOOP
        UPDATE questions q
        SET question_text = replacement.new_text,
            options = replacement.options::jsonb,
            correct_answer = replacement.correct_answer,
            explanation = replacement.explanation,
            option_notes = replacement.option_notes::jsonb
        FROM categories c
        WHERE c.id = q.category_id AND left(c.name, 3) = replacement.topic
          AND q.question_text IN (replacement.old_text, replacement.new_text);
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed <> 1 THEN
            RAISE EXCEPTION 'Миграция 029: раздел %, ожидался один вопрос, найдено %', replacement.topic, changed;
        END IF;
    END LOOP;
END
$replace$;

COMMIT;
`;
}

if (require.main === module) {
    fs.writeFileSync(path.join(__dirname, '../migrations/029_replace_semantic_duplicates.sql'), buildMigration());
    console.log('Миграция 029: подготовлены 16 замен.');
}
module.exports = { buildMigration };
