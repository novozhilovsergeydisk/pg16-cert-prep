const { test, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const pool = require('../src/config/db');
const { MAX_RATIO, MAX_LONGEST_SHARE, lengthRatio, isLengthBiased, longestCorrectShare, absoluteOnlyInWrong } = require('../scripts/lib/option-length');
after(() => pool.end());

// Темы, где варианты уже выровнены по длине; список растёт по мере переписывания тем.
const REWRITTEN_TOPICS = ['20.', '18.', '14.', '06.', '02.', '07.', '16.', '15.', '10.', '04.', '05.', '09.', '11.', '13.', '08.', '12.', '03.', '01.', '17.', '19.'];

const kindOf = (row) => (row.question_text.includes('___') ? 'code' : row.correct_answer.length > 1 ? 'multi' : 'single');

async function topicItems(topic) {
    const { rows } = await pool.query(
        "SELECT q.question_text, q.options, q.correct_answer FROM questions q JOIN categories c ON c.id = q.category_id WHERE left(c.name, 3) = $1 ORDER BY q.id",
        [topic]
    );
    assert.ok(rows.length > 0, 'Нет вопросов темы ' + topic);
    return rows.map((row) => ({
        q: row.question_text,
        kind: kindOf(row),
        opts: Object.entries(row.options).map(([key, text]) => [text, row.correct_answer.includes(key), '']),
    }));
}

for (const topic of REWRITTEN_TOPICS) {
    test(`Тема ${topic} длина вариантов не подсказывает ответ: порог ${MAX_RATIO} в каждом вопросе`, async () => {
        const items = await topicItems(topic);
        for (const item of items) assert.ok(!isLengthBiased(item), `${(lengthRatio(item) ?? 0).toFixed(2)}: ${item.q.slice(0, 60)}`);
    });

    test(`Тема ${topic} верный вариант самый длинный не чаще трети вопросов с одним ответом`, async () => {
        const share = longestCorrectShare(await topicItems(topic));
        assert.notEqual(share, null, 'слишком мало вопросов с одним ответом');
        assert.ok(share <= MAX_LONGEST_SHARE, `доля ${Math.round(share * 100)}%`);
    });

    test(`Тема ${topic} категоричные слова не стоят лишь в неверных вариантах`, async () => {
        for (const item of await topicItems(topic)) assert.ok(!absoluteOnlyInWrong(item), item.q.slice(0, 60));
    });
}
