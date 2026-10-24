const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_RATIO, MAX_LONGEST_SHARE, FIRST_CHECKED_SET, lengthRatio, isLengthBiased, longestCorrectShare, absoluteOnlyInWrong, isChecked } = require('../scripts/lib/option-length');

// Вариант: [текст, верный ли, пояснение]; пояснение для проверки длины не важно.
const opt = (length, ok) => ['x'.repeat(length), ok, 'n'];

test('Длина вариантов: один ответ — сравнивается самый длинный верный с самым длинным неверным', () => {
    const biased = { kind: 'single', opts: [opt(100, true), opt(40, false), opt(50, false), opt(30, false)] };
    assert.equal(lengthRatio(biased), 2);
    assert.ok(isLengthBiased(biased));
    const fair = { kind: 'single', opts: [opt(60, true), opt(55, false), opt(62, false), opt(30, false)] };
    assert.ok(!isLengthBiased(fair));
});

test('Длина вариантов: граница — ровно MAX_RATIO ещё допустима', () => {
    const edge = { kind: 'single', opts: [opt(Math.round(100 * MAX_RATIO), true), opt(100, false), opt(20, false), opt(20, false)] };
    assert.ok(!isLengthBiased(edge));
    const over = { kind: 'single', opts: [opt(Math.round(100 * MAX_RATIO) + 1, true), opt(100, false), opt(20, false), opt(20, false)] };
    assert.ok(isLengthBiased(over));
});

test('Длина вариантов: несколько ответов — по средним длинам верных и неверных', () => {
    const biased = { kind: 'multi', opts: [opt(90, true), opt(110, true), opt(40, false), opt(60, false)] };
    assert.equal(lengthRatio(biased), 2);
    assert.ok(isLengthBiased(biased));
    // Один верный вариант длиннее всех неверных, но в среднем верные не длиннее: подсказки нет.
    const fair = { kind: 'multi', opts: [opt(120, true), opt(30, true), opt(80, false), opt(70, false)] };
    assert.ok(!isLengthBiased(fair));
});

test('Длина вариантов: вопросы «допишите код» не проверяются', () => {
    const code = { kind: 'code', opts: [opt(200, true), opt(5, false), opt(5, false), opt(5, false)] };
    assert.equal(lengthRatio(code), null);
    assert.ok(!isLengthBiased(code));
});

test('Длина вариантов: проверяются только наборы с номера 061, прежние остаются как есть', () => {
    assert.equal(FIRST_CHECKED_SET, 61);
    assert.ok(!isChecked('059_isolation_lecture'));
    assert.ok(!isChecked('060_codex_review_fixes'));
    assert.ok(isChecked('061_anything'));
    assert.ok(isChecked('100_anything'));
});

test('Длина вариантов: доля вопросов, где верный вариант самый длинный, считается от 6 вопросов с одним ответом', () => {
    const longest = { kind: 'single', opts: [opt(100, true), opt(50, false), opt(50, false), opt(50, false)] };
    const fair = { kind: 'single', opts: [opt(50, true), opt(100, false), opt(50, false), opt(50, false)] };
    const multi = { kind: 'multi', opts: [opt(100, true), opt(100, true), opt(10, false), opt(10, false)] };
    assert.equal(longestCorrectShare([longest, fair, fair, fair, fair]), null, 'пять вопросов — мало');
    assert.equal(longestCorrectShare([longest, longest, fair, fair, fair, fair, multi]), 2 / 6);
    assert.ok(longestCorrectShare([longest, longest, longest, fair, fair, fair]) > MAX_LONGEST_SHARE);
});

test('Длина вариантов: «только», «всегда», «никогда», «лишь» не должны стоять лишь в неверных вариантах', () => {
    const o = (text, ok) => [text, ok, 'n'];
    assert.ok(absoluteOnlyInWrong({ kind: 'single', opts: [o('Индекс нужен', true), o('Индекс нужен только для сортировки', false)] }));
    assert.ok(!absoluteOnlyInWrong({ kind: 'single', opts: [o('Хранится только в таблице', true), o('Индекс нужен только для сортировки', false)] }));
    assert.ok(!absoluteOnlyInWrong({ kind: 'single', opts: [o('Индекс нужен', true), o('Индекс нужен для сортировки', false)] }));
    assert.ok(!absoluteOnlyInWrong({ kind: 'code', opts: [o('только', false), o('x', true)] }));
    assert.ok(absoluteOnlyInWrong({ kind: 'multi', opts: [o('А', true), o('Б', true), o('В никогда не бывает', false)] }));
    // Слово внутри другого слова не считается: «стольку» и «толькому» не существуют, «единственный» не содержит «только».
    assert.ok(!absoluteOnlyInWrong({ kind: 'single', opts: [o('Да', true), o('Единственный вариант', false)] }));
});
