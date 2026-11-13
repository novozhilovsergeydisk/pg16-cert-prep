// Дополнения по скриншотам лекции DBA1: файлы identity, oid2name, проверка lz4.
const { C, questions } = require('../lib/question-builder')();
const docs = 'https://www.postgresql.org/docs/16/';

C('11', 'Таблица public.t имеет identity-столбец id. Допишите функцию, чтобы получить путь к файлу связанной последовательности, не угадывая её имя:',
    "SELECT pg_relation_filepath(___('public.t', 'id'));", [
        ['pg_get_serial_sequence', true, 'Возвращает имя последовательности, связанной со столбцом SERIAL или IDENTITY.'],
        ['pg_sequence_last_value', false, 'Эта функция не получает имя последовательности по таблице и столбцу.'],
        ['pg_get_expr', false, 'Восстанавливает SQL-выражение по его внутреннему представлению.'],
        ['pg_get_indexdef', false, 'Восстанавливает определение индекса, а не имя последовательности.'],
    ], 'pg_get_serial_sequence возвращает имя связанной последовательности и для IDENTITY. Передача этого имени в pg_relation_filepath даёт путь к её основному файлу относительно PGDATA.');
questions.at(-1).sources = [docs + 'functions-info.html', docs + 'functions-admin.html'];

C('11', 'Команда oid2name -d practice выводит таблицы базы. Допишите ключ, чтобы включить в список также индексы и последовательности:',
    'oid2name -d practice ___', [
        ['-i', true, 'Добавляет индексы и последовательности в список отношений.'],
        ['-S', false, 'Включает системные объекты, а не индексы и последовательности пользовательских таблиц.'],
        ['-s', false, 'Выводит табличные пространства и их OID.'],
        ['-x', false, 'Добавляет сведения о схеме, табличном пространстве и OID уже выбранных объектов.'],
    ], 'Утилита oid2name с -d без фильтров выводит таблицы выбранной базы. Ключ -i включает также индексы и последовательности; -S отдельно управляет включением системных объектов.');
questions.at(-1).sources = [docs + 'oid2name.html'];

C('11', 'Нужно средствами SQL проверить параметры сборки сервера на наличие --with-lz4. Допишите имя системного представления:',
    "SELECT setting FROM ___ WHERE name = 'CONFIGURE';", [
        ['pg_config', true, 'Представление содержит параметры сборки работающего сервера, в том числе строку CONFIGURE.'],
        ['pg_settings', false, 'Содержит параметры настройки сервера, но не строку CONFIGURE с параметрами сборки.'],
        ['pg_file_settings', false, 'Показывает настройки из конфигурационных файлов, а не параметры компиляции.'],
        ['pg_available_extensions', false, 'Перечисляет доступные SQL-расширения; сжатие lz4 для TOAST не устанавливают через CREATE EXTENSION.'],
    ], 'В представлении pg_config строка CONFIGURE содержит параметры сборки: --with-lz4 означает поддержку lz4. Метод pglz встроен. SHOW default_toast_compression показывает выбранный метод по умолчанию, а не перечень методов, доступных в сборке. Доступ к pg_config по умолчанию ограничен суперпользователями.');
questions.at(-1).sources = [docs + 'view-pg-config.html', docs + 'runtime-config-client.html'];

module.exports = {
    migration: '147_low_level_files',
    header: 'Три вопроса раздела 11 по файлам identity, oid2name -i и SQL-проверке поддержки lz4.',
    seed: 20261113,
    target: { '11': 3 },
    strictInsert: true,
    questions,
};
