// Раздел «03. Конфигурирование» (входит в экзамен): восемь вопросов по пробелам, найденным при сверке с лекцией
// курса DBA1 по теме 03: config_file, единицы в pg_settings, значения context, параметры с перезапуском,
// sourcefile и sourceline, ALTER SYSTEM RESET ALL, current_setting с missing_ok, параметры при пуле соединений.
// Ориентир — PostgreSQL 16.
// Пересборка: node scripts/gen-questions.js scripts/questions/053_configuration_lecture.js
const { S, M, C, questions } = require('../lib/question-builder')();
const docs = 'https://www.postgresql.org/docs/16/';
const source = (...pages) => { questions.at(-1).sources = pages; };

S('03', 'Как из SQL-сеанса узнать, где находится основной файл конфигурации postgresql.conf работающего сервера?', [
    ['SHOW config_file;', true, 'Параметр config_file хранит полный путь к основному файлу конфигурации.'],
    ['SHOW data_directory;', false, 'Это каталог данных; postgresql.conf может лежать и вне его, как в пакетах Debian и Ubuntu.'],
    ['SELECT pg_reload_conf();', false, 'Функция перечитывает конфигурацию, а путь к файлу не показывает.'],
    ['SHOW hba_file;', false, 'Это путь к файлу pg_hba.conf с правилами аутентификации.'],
], 'В пакетах Debian и Ubuntu ответ — /etc/postgresql/16/main/postgresql.conf; при сборке из исходников файл обычно лежит в каталоге данных. Файл postgresql.auto.conf всегда лежит в каталоге данных: SHOW data_directory;');
source(docs + 'runtime-config-file-locations.html');

S('03', 'Запрос SELECT setting, unit FROM pg_settings WHERE name = \'work_mem\'; вернул 4096 и kB. Чему равен work_mem?', [
    ['4 МБ: значение указано в единицах из столбца unit, то есть 4096 КБ', true, 'В столбце setting число, а единицу измерения задаёт столбец unit.'],
    ['4096 байт', false, 'Единица указана в столбце unit — это килобайты, а не байты.'],
    ['4096 МБ', false, 'unit = kB означает килобайты; 4096 МБ — это 4 ГБ.'],
    ['4096 страниц по 8 КБ', false, 'В страницах по 8 КБ измеряются другие параметры, например shared_buffers: у него unit = 8kB.'],
], 'Команда SHOW work_mem; сразу показывает значение с единицей: 4MB. У shared_buffers по умолчанию setting = 16384 и unit = 8kB, то есть 128 МБ.');
source(docs + 'view-pg-settings.html', docs + 'config-setting.html');

M('03', 'Что верно для значений user, superuser и internal столбца context в pg_settings?', [
    ['internal — параметр изменить нельзя, например block_size', true, 'Параметр internal нельзя изменить ни файлом конфигурации, ни командой SET; например, block_size задаётся при сборке сервера.'],
    ['user — любой пользователь может изменить параметр в своём сеансе, например work_mem', true, 'Для этого достаточно команды SET.'],
    ['superuser — в своём сеансе параметр может изменить суперпользователь или роль, которой выдано право SET на этот параметр', true, 'Пример — log_statement: обычная роль получит ошибку «нет прав для изменения параметра».'],
    ['user — для применения нового значения нужен перезапуск сервера', false, 'Перезапуск нужен при context = postmaster.'],
    ['internal — параметр меняется только командой ALTER SYSTEM', false, 'Параметры internal нельзя изменить никак: ALTER SYSTEM ответит, что параметр нельзя изменить.'],
], 'Кроме того, бывают postmaster (нужен перезапуск) и sighup (достаточно перечитать конфигурацию), а также backend и superuser-backend: такие параметры задают при подключении, а в уже начатом сеансе изменить нельзя. Проверка: SELECT name, context FROM pg_settings WHERE name IN (\'block_size\', \'work_mem\', \'log_statement\');');
source(docs + 'view-pg-settings.html', docs + 'sql-grant.html');

C('03', 'Допишите запрос, чтобы получить список параметров, изменение которых вступает в силу только после перезапуска сервера:', 'SELECT name FROM pg_settings WHERE context = \'___\';', [
    ['`postmaster`', true, 'Такие параметры читает только postmaster при запуске, например shared_buffers и max_connections.'],
    ['`sighup`', false, 'Для них достаточно перечитать конфигурацию без перезапуска.'],
    ['`internal`', false, 'Их нельзя изменить вовсе, даже перезапуском.'],
    ['`restart`', false, 'Такого значения context нет.'],
], 'Если такой параметр изменён в файле, после перечитывания конфигурации в pg_settings у него будет pending_restart = true, а в pg_file_settings — applied = false.');
source(docs + 'view-pg-settings.html', docs + 'runtime-config-resource.html#GUC-SHARED-BUFFERS');

S('03', 'Какие столбцы pg_settings показывают, из какого файла и с какой строки взято текущее значение параметра?', [
    ['sourcefile и sourceline', true, 'Если текущее значение взято из файла конфигурации, они показывают файл и номер строки. Для других источников они пусты, как и для пользователя без прав суперпользователя или членства в роли pg_read_all_settings.'],
    ['boot_val и reset_val', false, 'Это значение по умолчанию и значение, к которому вернёт команда RESET.'],
    ['context и pending_restart', false, 'Это способ изменения параметра и признак того, что новое значение ждёт перезапуска.'],
    ['setting и unit', false, 'Это текущее значение и единица измерения.'],
], 'Если параметр задан в нескольких файлах, столбцы показывают действующее значение, то есть прочитанное последним.');
source(docs + 'view-pg-settings.html');

S('03', 'Что делает команда ALTER SYSTEM RESET ALL?', [
    ['Удаляет из postgresql.auto.conf все параметры, заданные через ALTER SYSTEM; изменения вступят в силу после перечитывания конфигурации или перезапуска', true, 'ALTER SYSTEM меняет только файл, а действующие значения остаются прежними до перечитывания. Параметрам с context = postmaster одного перечитывания мало, нужен перезапуск.'],
    ['Сбрасывает все параметры текущего сеанса к значениям из reset_val', false, 'Это делает команда RESET ALL без ALTER SYSTEM.'],
    ['Удаляет все параметры из postgresql.conf', false, 'ALTER SYSTEM работает только с файлом postgresql.auto.conf.'],
    ['Сразу возвращает всем параметрам значения по умолчанию на работающем сервере', false, 'Действующие значения изменятся только после перечитывания конфигурации.'],
], 'После перечитывания снова начнут действовать значения из postgresql.conf и подключённых к нему файлов, которые раньше перекрывал postgresql.auto.conf.');
source(docs + 'sql-altersystem.html');

S('03', 'Пользовательский параметр myapp.currency в этом сеансе ещё ни разу не задавался. Что вернёт SELECT current_setting(\'myapp.currency\', true);?', [
    ['NULL', true, 'Второй аргумент true разрешает отсутствие параметра: вместо ошибки возвращается NULL.'],
    ['Ошибку «нераспознанный параметр конфигурации»', false, 'Так будет без второго аргумента или с false.'],
    ['Пустую строку', false, 'Пустую строку вернёт параметр, который уже создавался в сеансе, например командой SET LOCAL в завершившейся транзакции; для ни разу не заданного параметра будет NULL.'],
    ['Значение true', false, 'Второй аргумент — признак «отсутствие допустимо», а не значение по умолчанию.'],
], 'Пользовательские параметры удобны как переменные сеанса. Их можно задать и в файле конфигурации, например через ALTER SYSTEM SET myapp.currency = \'RUB\'; после перечитывания значение увидят все новые сеансы.');
source(docs + 'functions-admin.html#FUNCTIONS-ADMIN-SET', docs + 'runtime-config-custom.html');

S('03', 'Приложение работает через пул соединений в режиме пула транзакций и внутри своей транзакции меняет параметр. Как это сделать, чтобы изменение не повлияло на транзакции других клиентов?', [
    ['Командой SET LOCAL или функцией set_config с третьим аргументом true: значение действует только до конца текущей транзакции', true, 'После COMMIT или ROLLBACK параметр вернётся к прежнему значению.'],
    ['Командой SET: значение действует до конца сеанса', false, 'Через пул один сеанс сервера обслуживает и чужие транзакции, и они увидят изменённое значение.'],
    ['Командой ALTER SYSTEM SET и вызовом pg_reload_conf()', false, 'Это изменит значение для всего сервера.'],
    ['Командой ALTER ROLE ... SET', false, 'Это значение по умолчанию для новых сеансов роли, а не для одной транзакции.'],
], 'В режиме пула транзакций следующая транзакция того же клиента может попасть в другой сеанс сервера, а в его сеанс — транзакция другого клиента.');
source(docs + 'sql-set.html', docs + 'functions-admin.html#FUNCTIONS-ADMIN-SET');

module.exports = {
    migration: '053_configuration_lecture',
    header: 'Восемь вопросов раздела «03. Конфигурирование» по сверке с лекцией: config_file, единицы в pg_settings, значения context, параметры с перезапуском, sourcefile и sourceline, ALTER SYSTEM RESET ALL, current_setting с missing_ok, параметры при пуле соединений; пояснения к каждому варианту.',
    seed: 20261305,
    target: { '03': 8 },
    strictInsert: true,
    questions,
};
