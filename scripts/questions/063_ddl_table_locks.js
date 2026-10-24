// Восемь вопросов к темам 04 и 05: транзакционность DDL и блокировки на уровне таблиц с примерами.
// Темы 04 — откат DDL и команды, которые нельзя выполнить в блоке транзакции; 05 — режимы табличных блокировок,
// какие команды что берут, очередь за ALTER TABLE и как найти причину ожидания. Ориентир — PostgreSQL 16.
// Пересборка: node scripts/gen-questions.js scripts/questions/063_ddl_table_locks.js
const { S, M, questions } = require('../lib/question-builder')();
const docs = 'https://www.postgresql.org/docs/16/';
const source = (...pages) => { questions.at(-1).sources = pages; };

S('04', 'Выполнены команды BEGIN; DROP TABLE t; ROLLBACK; Что будет с таблицей t?', [
    ['Таблица t останется на месте со всеми строками: DROP TABLE откатывается', true, 'DROP TABLE в PostgreSQL транзакционна: при откате возвращаются и сама таблица, и все её строки.'],
    ['Таблица t будет удалена, потому что DROP TABLE фиксируется сразу при выполнении', false, 'Сразу фиксируются команды вне блока транзакции, в режиме автофиксации. Внутри BEGIN удаление отменяется откатом.'],
    ['Таблица t останется пустой: ROLLBACK восстановит её структуру без строк', false, 'Откат восстанавливает таблицу целиком: и структуру, и данные.'],
    ['ROLLBACK завершится ошибкой, потому что DDL нельзя отменять внутри транзакции', false, 'ROLLBACK отменяет и команды DDL, никакой ошибки нет.'],
], 'Блок BEGIN … ROLLBACK работает и с командами, меняющими схему: CREATE, ALTER, DROP, TRUNCATE. Проверка: BEGIN; DROP TABLE t; SELECT count(*) FROM t; — внутри транзакции таблицы уже нет (будет ошибка); ROLLBACK; SELECT count(*) FROM t; — таблица вернулась.');
source(docs + 'ddl.html', docs + 'tutorial-transactions.html');

M('04', 'В одной транзакции выполнены CREATE TABLE a (x int); ALTER TABLE t ADD COLUMN c int; TRUNCATE t; затем ROLLBACK. Что верно после отката?', [
    ['Таблицы a нет: её создание отменено откатом вместе со всей транзакцией', true, 'CREATE TABLE транзакционна: при откате таблица исчезает.'],
    ['Столбец c в таблице t не появился: изменение структуры отменено', true, 'ALTER TABLE ADD COLUMN откатывается: структура возвращается к исходной.'],
    ['Строки t вернулись: TRUNCATE отменён вместе с остальными командами', true, 'TRUNCATE в PostgreSQL можно откатить: строки возвращаются.'],
    ['Таблица a осталась, но пустая, потому что данные в ней не создавались', false, 'Откат удаляет таблицу целиком, а не только её данные.'],
    ['Откатилась команда CREATE TABLE, а ALTER TABLE и TRUNCATE уже сохранились', false, 'ROLLBACK отменяет все команды транзакции, в том числе DDL: частичной фиксации нет.'],
], 'Команды DDL, кроме немногих исключений (например, CREATE DATABASE и VACUUM), выполняются внутри обычной транзакции и откатываются вместе с остальными изменениями. Проверка: BEGIN; CREATE TABLE a (x int); ROLLBACK; SELECT to_regclass(\'a\'); — результат NULL.');
source(docs + 'ddl.html', docs + 'sql-truncate.html', docs + 'tutorial-transactions.html');

M('04', 'Какие команды нельзя выполнить внутри блока транзакции BEGIN … COMMIT?', [
    ['`CREATE DATABASE app2`', true, 'CREATE DATABASE запрещена внутри блока транзакции: её выполняют отдельной командой вне BEGIN … COMMIT.'],
    ['`VACUUM VERBOSE t`', true, 'VACUUM работает со своими внутренними транзакциями и не может выполняться внутри блока.'],
    ['`CREATE INDEX CONCURRENTLY ON t (v)`', true, 'CREATE INDEX CONCURRENTLY строит индекс в несколько транзакций, поэтому внутри блока запрещён.'],
    ['`CREATE INDEX ON t (v)`', false, 'Обычный CREATE INDEX транзакционен и разрешён в блоке; он берёт блокировку SHARE на таблицу.'],
    ['`ALTER TABLE t ADD COLUMN c int`', false, 'Эта форма ALTER TABLE (ADD COLUMN) разрешена в блоке транзакции и откатывается. Некоторые формы запрещены, например DETACH PARTITION … CONCURRENTLY.'],
], 'Внутри блока запрещены и другие команды, которые нельзя откатить или которые используют несколько транзакций: DROP DATABASE, REINDEX CONCURRENTLY, ALTER SYSTEM. Сервер отвечает ошибкой «не может выполняться внутри блока транзакции».');
source(docs + 'sql-createdatabase.html', docs + 'sql-vacuum.html', docs + 'sql-createindex.html');

M('05', 'Таблица t (id int PRIMARY KEY, v int) без других ограничений и триггеров. Сеанс 1 выполнил BEGIN; UPDATE t SET v = 0 WHERE id = 1; и не завершил транзакцию. Какие команды сеанса 2 не будут ждать блокировок сеанса 1?', [
    ['`SELECT * FROM t`', true, 'SELECT берёт ACCESS SHARE, которая не конфликтует с ROW EXCLUSIVE от UPDATE; читать можно, строку чтение не блокирует.'],
    ['`UPDATE t SET v = 2 WHERE id = 2`', true, 'UPDATE берёт ROW EXCLUSIVE на таблицу и блокировку своей строки. ROW EXCLUSIVE не конфликтует сама с собой, строка другая, а уникальных ограничений по v, которые заставили бы ждать, нет.'],
    ['`ALTER TABLE t ADD COLUMN c int`', false, 'ALTER TABLE ADD COLUMN требует ACCESS EXCLUSIVE, несовместимую с ROW EXCLUSIVE: команда ждёт конца транзакции сеанса 1.'],
    ['`TRUNCATE TABLE t`', false, 'TRUNCATE требует ACCESS EXCLUSIVE и ждёт конца транзакции сеанса 1.'],
    ['`CREATE INDEX ON t (v)`', false, 'CREATE INDEX без CONCURRENTLY берёт SHARE, несовместимую с ROW EXCLUSIVE: ждёт конца транзакции сеанса 1.'],
], 'Совместимость можно проверить опытом: открыть в одном сеансе транзакцию с UPDATE, а в другом выполнить SET lock_timeout = \'2s\' и нужную команду: несовместимая команда завершится ошибкой по таймауту. Таблица совместимости режимов — в разделе Explicit Locking документации.');
source(docs + 'explicit-locking.html#LOCKING-TABLES');

M('05', 'Какие из этих команд берут блокировку ACCESS EXCLUSIVE и поэтому не работают одновременно даже с обычным SELECT?', [
    ['`TRUNCATE TABLE t`', true, 'TRUNCATE берёт ACCESS EXCLUSIVE: пока она работает, таблица недоступна даже для чтения.'],
    ['`VACUUM FULL t`', true, 'VACUUM FULL перестраивает таблицу и берёт ACCESS EXCLUSIVE: пока он работает, таблица недоступна даже для чтения.'],
    ['`ALTER TABLE t ADD COLUMN c int`', true, 'ALTER TABLE ADD COLUMN берёт ACCESS EXCLUSIVE; большинство форм ALTER TABLE работают так же.'],
    ['`VACUUM (TRUNCATE false) t`', false, 'Без усечения хвоста VACUUM работает с блокировкой SHARE UPDATE EXCLUSIVE: читать и изменять таблицу при нём можно. Обычный VACUUM в конце работы может ненадолго взять ACCESS EXCLUSIVE, чтобы отрезать пустые страницы в конце таблицы; параметр TRUNCATE false это отключает.'],
    ['`INSERT INTO t VALUES (1, 1)`', false, 'INSERT берёт ROW EXCLUSIVE, совместимую с ACCESS SHARE обычного SELECT.'],
], 'Режим блокировки, которую удерживает команда, видно в pg_locks: BEGIN; ALTER TABLE t ADD COLUMN c int; SELECT mode FROM pg_locks WHERE relation = \'t\'::regclass; ROLLBACK; (VACUUM в блоке транзакции выполнять нельзя). DROP TABLE тоже берёт ACCESS EXCLUSIVE.');
source(docs + 'explicit-locking.html#LOCKING-TABLES', docs + 'sql-vacuum.html', docs + 'sql-truncate.html');

S('05', 'Сеанс 1 в режиме автофиксации выполняет CREATE INDEX ON t (v) на большой таблице, без CONCURRENTLY. Что будет с чтением (SELECT) и записью (INSERT, UPDATE, DELETE) таблицы t в других сеансах, пока строится индекс?', [
    ['Чтение выполняется, а запись ждёт окончания построения индекса', true, 'Блокировка SHARE допускает чтение, но конфликтует с ROW EXCLUSIVE, которую берут INSERT, UPDATE и DELETE. SHARE держится до конца транзакции; в режиме автофиксации она заканчивается вместе с командой.'],
    ['Чтение и запись ждут: таблица недоступна до окончания построения индекса', false, 'SELECT берёт ACCESS SHARE, совместимую с SHARE: чтение продолжается.'],
    ['Чтение и запись выполняются: индекс строится без блокировки таблицы', false, 'Обычный CREATE INDEX блокирует изменения таблицы; без блокировки записи строит индекс только вариант CONCURRENTLY.'],
    ['Чтение ждёт окончания построения, а запись выполняется без ожидания', false, 'Наоборот: чтение разрешено, а запись ждёт.'],
], 'С CREATE INDEX CONCURRENTLY таблица для записи не блокируется (блокировка SHARE UPDATE EXCLUSIVE), но построение идёт дольше, а саму команду нельзя выполнять внутри блока транзакции.');
source(docs + 'sql-createindex.html', docs + 'explicit-locking.html#LOCKING-TABLES');

S('05', 'Транзакция в сеансе 1 прочитала таблицу t и не завершена. Сеанс 2 запустил ALTER TABLE t ADD COLUMN c int и ждёт. Сеанс 3 начинает новую транзакцию и впервые обращается к t: SELECT * FROM t. Что будет с этим запросом?', [
    ['Он встанет в очередь за ALTER TABLE и тоже будет ждать', true, 'Запрос ACCESS SHARE встаёт за ранее ожидающим несовместимым ACCESS EXCLUSIVE. Поэтому ожидающий ALTER TABLE задерживает новые чтения, которым ещё нужно получить блокировку таблицы.'],
    ['Он выполнится сразу: обычный SELECT берёт совместимую блокировку ACCESS SHARE', false, 'ACCESS SHARE совместима с блокировкой сеанса 1, но в очереди уже стоит ACCESS EXCLUSIVE команды ALTER TABLE, и новый запрос встаёт за ним.'],
    ['Он завершится ошибкой, потому что таблица заблокирована командой ALTER TABLE', false, 'Ошибки нет: запрос ждёт своей очереди, а при заданном lock_timeout — до таймаута.'],
    ['Он прервёт ожидающий ALTER TABLE и выполнится раньше него', false, 'Ожидающая команда ничего не прерывает: порядок определяет очередь.'],
], 'Поэтому ALTER TABLE на рабочей таблице выполняют с небольшим lock_timeout: если команда не получила блокировку быстро, она завершается ошибкой, не задерживая остальные запросы.');
source(docs + 'explicit-locking.html#LOCKING-TABLES', docs + 'runtime-config-client.html#GUC-LOCK-TIMEOUT');

M('05', 'Сеанс ждёт блокировку. Что верно о поиске причины ожидания и об ограничении времени ожидания?', [
    ['Функция pg_blocking_pids(pid) возвращает номера процессов, блокирующих ожидающий', true, 'Функция принимает номер процесса ожидающего сеанса и возвращает массив номеров процессов, которые его блокируют.'],
    ['В pg_locks у ожидающего сеанса есть строка с granted = false', true, 'Ожидающий запрос в pg_locks виден по granted = false; в pg_stat_activity у него wait_event_type равен Lock.'],
    ['Заданный заранее lock_timeout = \'2s\' прервёт ожидание блокировки ошибкой через 2 с', true, 'При превышении лимита текущий оператор завершается ошибкой. Параметр задают до запроса: SET для сеанса или SET LOCAL внутри транзакции. Уже ждущий сеанс не выполнит новый SET, пока не закончится текущий запрос.'],
    ['Увеличение deadlock_timeout заставляет сервер быстрее снимать блокировки', false, 'deadlock_timeout — время до проверки взаимоблокировки, а не срок удержания блокировок.'],
    ['Блокирующий сеанс виден в представлении pg_stat_replication со статусом waiting', false, 'pg_stat_replication описывает процессы отправки WAL и статуса waiting не содержит; ожидание блокировок смотрят в pg_stat_activity, pg_locks и через pg_blocking_pids.'],
], 'Опыт на двух сеансах: в первом BEGIN; LOCK TABLE t; во втором SET lock_timeout = \'2s\'; SELECT * FROM t; — через две секунды ошибка. В третьем: SELECT pid, pg_blocking_pids(pid), wait_event_type FROM pg_stat_activity;');
source(docs + 'functions-info.html#FUNCTIONS-INFO-SESSION', docs + 'view-pg-locks.html', docs + 'runtime-config-client.html#GUC-LOCK-TIMEOUT');

module.exports = {
    migration: '063_ddl_table_locks',
    header: 'Восемь вопросов к темам 04 и 05: транзакционность DDL, команды, которые нельзя выполнить в блоке транзакции, режимы блокировок таблиц, какие команды что берут, очередь за ALTER TABLE, поиск причины ожидания; пояснения к каждому варианту.',
    seed: 20262015,
    target: { '04': 3, '05': 5 },
    strictInsert: true,
    questions,
};
