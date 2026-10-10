// Описание вопросов для генератора миграций.
// Вариант: [текст, верный ли, пояснение к варианту]. Код вопроса «дополните код» оформляется блоком ```.
module.exports = function questionBuilder() {
    const questions = [];
    return {
        questions,
        // один правильный ответ
        S: (t, q, opts, e) => questions.push({ t, kind: 'single', q, opts, e }),
        // несколько правильных ответов
        M: (t, q, opts, e) => questions.push({ t, kind: 'multi', q, opts, e }),
        // дополните код: фрагмент с пропуском ___
        C: (t, q, code, opts, e) => questions.push({ t, kind: 'code', q: q + '\n```\n' + code + '\n```', opts, e }),
    };
};
