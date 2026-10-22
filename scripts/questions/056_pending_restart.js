// Пояснение к вопросу темы 03 о pending_restart: что означает флаг и когда он появляется.
// Ключи ответов, число и порядок вариантов не меняются.
// Пересборка: node scripts/gen-process-memory-fixes.js 056_pending_restart
module.exports = {
    migration: '056_pending_restart',
    header: 'Пояснение к вопросу темы 03 о pending_restart: флаг появляется после перечитывания конфигурации.',
    fixes: [
        {
            kind: 'explanation',
            q: 'Что означает значение pending_restart = true в pg_settings?',
            old: 'Параметры с ожидающим перезапуска изменением выбирает условие WHERE pending_restart. Условие context = postmaster даёт все параметры, которые меняются только перезапуском, а не только ожидающие.',
            new: 'pending_restart = true появляется после перечитывания конфигурации, если в файле изменён параметр с context = postmaster: новое значение прочитано, но подействует только после перезапуска сервера. До перечитывания флаг остаётся false. Найти такие параметры: SELECT name FROM pg_settings WHERE pending_restart;',
        },
    ],
};
