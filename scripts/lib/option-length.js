// Проверка, что длина варианта не подсказывает верный ответ.
// Вопрос с одним ответом: длина самого длинного верного варианта к длине самого длинного неверного.
// Вопрос с несколькими ответами: средняя длина верных к средней длине неверных.
// Вопросы «допишите код» не проверяются: их варианты — короткие фрагменты кода.
// Вариант: [текст, верный ли, пояснение к варианту], как в scripts/lib/question-builder.js.
const MAX_RATIO = 1.3;
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

// Номер набора из имени миграции, например 059_isolation_lecture → 59.
const setNumber = (migration) => parseInt(migration, 10);
const isChecked = (migration) => setNumber(migration) >= FIRST_CHECKED_SET;

module.exports = { MAX_RATIO, FIRST_CHECKED_SET, lengthRatio, isLengthBiased, isChecked };
