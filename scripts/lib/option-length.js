// Проверка, что длина варианта не подсказывает верный ответ.
// Вопрос с одним ответом: длина самого длинного верного варианта к длине самого длинного неверного.
// Вопрос с несколькими ответами: средняя длина верных к средней длине неверных.
// Вопросы «допишите код» не проверяются: их варианты — короткие фрагменты кода.
// Вариант: [текст, верный ли, пояснение к варианту], как в scripts/lib/question-builder.js.
const MAX_RATIO = 1.3;
// Тема или набор в целом: верный вариант самый длинный не чаще чем в трети вопросов с одним ответом.
// На малых наборах доля ничего не значит, поэтому проверяется от MIN_SINGLE таких вопросов.
const MAX_LONGEST_SHARE = 1 / 3;
const MIN_SINGLE = 6;
// Наборы с меньшим номером выложены до появления правила и остаются как есть.
const FIRST_CHECKED_SET = 61;

const lengths = (opts, correct) => opts.filter((o) => o[1] === correct).map((o) => o[0].length);
const mean = (list) => list.reduce((sum, n) => sum + n, 0) / list.length;

function lengthRatio(item) {
    if (item.kind === 'code') return null;
    const right = lengths(item.opts, true);
    const wrong = lengths(item.opts, false);
    if (!right.length || !wrong.length) return null;
    return item.kind === 'multi' ? mean(right) / mean(wrong) : Math.max(...right) / Math.max(...wrong);
}

const isLengthBiased = (item, max = MAX_RATIO) => (lengthRatio(item) ?? 0) > max;

// Доля вопросов с одним ответом, где верный вариант строго длиннее всех неверных; null, если вопросов мало.
function longestCorrectShare(items) {
    const singles = items.filter((item) => item.kind === 'single');
    if (singles.length < MIN_SINGLE) return null;
    const longest = singles.filter((item) => Math.max(...lengths(item.opts, true)) > Math.max(...lengths(item.opts, false)));
    return longest.length / singles.length;
}

// Категоричные слова выдают неверный вариант, если стоят только в неверных.
const ABSOLUTE_WORDS = /(^|[^а-яё])(только|всегда|никогда|лишь)(?=[^а-яё]|$)/i;
const hasAbsolute = (text) => ABSOLUTE_WORDS.test(text);
function absoluteOnlyInWrong(item) {
    if (item.kind === 'code') return false;
    const inWrong = item.opts.some((o) => !o[1] && hasAbsolute(o[0]));
    const inRight = item.opts.some((o) => o[1] && hasAbsolute(o[0]));
    return inWrong && !inRight;
}

// Номер набора из имени миграции, например 059_isolation_lecture → 59.
const setNumber = (migration) => parseInt(migration, 10);
const isChecked = (migration) => setNumber(migration) >= FIRST_CHECKED_SET;

module.exports = {
    MAX_RATIO, MAX_LONGEST_SHARE, MIN_SINGLE, FIRST_CHECKED_SET,
    lengthRatio, isLengthBiased, longestCorrectShare, absoluteOnlyInWrong, isChecked,
};
