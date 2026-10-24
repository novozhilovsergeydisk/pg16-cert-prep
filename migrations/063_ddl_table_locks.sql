-- Восемь вопросов к темам 04 и 05: транзакционность DDL, команды, которые нельзя выполнить в блоке транзакции, режимы блокировок таблиц, какие команды что берут, очередь за ALTER TABLE, поиск причины ожидания; пояснения к каждому варианту.
-- Источник: scripts/questions/063_ddl_table_locks.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/ddl.html
-- https://www.postgresql.org/docs/16/tutorial-transactions.html
-- https://www.postgresql.org/docs/16/sql-truncate.html
-- https://www.postgresql.org/docs/16/sql-createdatabase.html
-- https://www.postgresql.org/docs/16/sql-vacuum.html
-- https://www.postgresql.org/docs/16/sql-createindex.html
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-TABLES
-- https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-LOCK-TIMEOUT
-- https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION
-- https://www.postgresql.org/docs/16/view-pg-locks.html

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Выполнены команды BEGIN; DROP TABLE t; ROLLBACK; Что будет с таблицей t?', '{"A":"Таблица t останется на месте со всеми строками: DROP TABLE откатывается","B":"Таблица t останется пустой: ROLLBACK восстановит её структуру без строк","C":"Таблица t будет удалена, потому что DROP TABLE фиксируется сразу при выполнении","D":"ROLLBACK завершится ошибкой, потому что DDL нельзя отменять внутри транзакции"}'::jsonb, 'A', 'Блок BEGIN … ROLLBACK работает и с командами, меняющими схему: CREATE, ALTER, DROP, TRUNCATE. Проверка: BEGIN; DROP TABLE t; SELECT count(*) FROM t; — внутри транзакции таблицы уже нет (будет ошибка); ROLLBACK; SELECT count(*) FROM t; — таблица вернулась.', '{"A":"DROP TABLE в PostgreSQL транзакционна: при откате возвращаются и сама таблица, и все её строки.","B":"Откат восстанавливает таблицу целиком: и структуру, и данные.","C":"Сразу фиксируются команды вне блока транзакции, в режиме автофиксации. Внутри BEGIN удаление отменяется откатом.","D":"ROLLBACK отменяет и команды DDL, никакой ошибки нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'В одной транзакции выполнены CREATE TABLE a (x int); ALTER TABLE t ADD COLUMN c int; TRUNCATE t; затем ROLLBACK. Что верно после отката?', '{"A":"Таблица a осталась, но пустая, потому что данные в ней не создавались","B":"Строки t вернулись: TRUNCATE отменён вместе с остальными командами","C":"Столбец c в таблице t не появился: изменение структуры отменено","D":"Таблицы a нет: её создание отменено откатом вместе со всей транзакцией","E":"Откатилась команда CREATE TABLE, а ALTER TABLE и TRUNCATE уже сохранились"}'::jsonb, 'BCD', 'Команды DDL, кроме немногих исключений (например, CREATE DATABASE и VACUUM), выполняются внутри обычной транзакции и откатываются вместе с остальными изменениями. Проверка: BEGIN; CREATE TABLE a (x int); ROLLBACK; SELECT to_regclass(''a''); — результат NULL.', '{"A":"Откат удаляет таблицу целиком, а не только её данные.","B":"TRUNCATE в PostgreSQL можно откатить: строки возвращаются.","C":"ALTER TABLE ADD COLUMN откатывается: структура возвращается к исходной.","D":"CREATE TABLE транзакционна: при откате таблица исчезает.","E":"ROLLBACK отменяет все команды транзакции, в том числе DDL: частичной фиксации нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Какие команды нельзя выполнить внутри блока транзакции BEGIN … COMMIT?', '{"A":"`CREATE DATABASE app2`","B":"`CREATE INDEX ON t (v)`","C":"`ALTER TABLE t ADD COLUMN c int`","D":"`VACUUM VERBOSE t`","E":"`CREATE INDEX CONCURRENTLY ON t (v)`"}'::jsonb, 'ADE', 'Внутри блока запрещены и другие команды, которые нельзя откатить или которые используют несколько транзакций: DROP DATABASE, REINDEX CONCURRENTLY, ALTER SYSTEM. Сервер отвечает ошибкой «не может выполняться внутри блока транзакции».', '{"A":"CREATE DATABASE запрещена внутри блока транзакции: её выполняют отдельной командой вне BEGIN … COMMIT.","B":"Обычный CREATE INDEX транзакционен и разрешён в блоке; он берёт блокировку SHARE на таблицу.","C":"Эта форма ALTER TABLE (ADD COLUMN) разрешена в блоке транзакции и откатывается. Некоторые формы запрещены, например DETACH PARTITION … CONCURRENTLY.","D":"VACUUM работает со своими внутренними транзакциями и не может выполняться внутри блока.","E":"CREATE INDEX CONCURRENTLY строит индекс в несколько транзакций, поэтому внутри блока запрещён."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Таблица t (id int PRIMARY KEY, v int) без других ограничений и триггеров. Сеанс 1 выполнил BEGIN; UPDATE t SET v = 0 WHERE id = 1; и не завершил транзакцию. Какие команды сеанса 2 не будут ждать блокировок сеанса 1?', '{"A":"`TRUNCATE TABLE t`","B":"`ALTER TABLE t ADD COLUMN c int`","C":"`UPDATE t SET v = 2 WHERE id = 2`","D":"`SELECT * FROM t`","E":"`CREATE INDEX ON t (v)`"}'::jsonb, 'CD', 'Совместимость можно проверить опытом: открыть в одном сеансе транзакцию с UPDATE, а в другом выполнить SET lock_timeout = ''2s'' и нужную команду: несовместимая команда завершится ошибкой по таймауту. Таблица совместимости режимов — в разделе Explicit Locking документации.', '{"A":"TRUNCATE требует ACCESS EXCLUSIVE и ждёт конца транзакции сеанса 1.","B":"ALTER TABLE ADD COLUMN требует ACCESS EXCLUSIVE, несовместимую с ROW EXCLUSIVE: команда ждёт конца транзакции сеанса 1.","C":"UPDATE берёт ROW EXCLUSIVE на таблицу и блокировку своей строки. ROW EXCLUSIVE не конфликтует сама с собой, строка другая, а уникальных ограничений по v, которые заставили бы ждать, нет.","D":"SELECT берёт ACCESS SHARE, которая не конфликтует с ROW EXCLUSIVE от UPDATE; читать можно, строку чтение не блокирует.","E":"CREATE INDEX без CONCURRENTLY берёт SHARE, несовместимую с ROW EXCLUSIVE: ждёт конца транзакции сеанса 1."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Какие из этих команд берут блокировку ACCESS EXCLUSIVE и поэтому не работают одновременно даже с обычным SELECT?', '{"A":"`INSERT INTO t VALUES (1, 1)`","B":"`ALTER TABLE t ADD COLUMN c int`","C":"`TRUNCATE TABLE t`","D":"`VACUUM (TRUNCATE false) t`","E":"`VACUUM FULL t`"}'::jsonb, 'BCE', 'Режим блокировки, которую удерживает команда, видно в pg_locks: BEGIN; ALTER TABLE t ADD COLUMN c int; SELECT mode FROM pg_locks WHERE relation = ''t''::regclass; ROLLBACK; (VACUUM в блоке транзакции выполнять нельзя). DROP TABLE тоже берёт ACCESS EXCLUSIVE.', '{"A":"INSERT берёт ROW EXCLUSIVE, совместимую с ACCESS SHARE обычного SELECT.","B":"ALTER TABLE ADD COLUMN берёт ACCESS EXCLUSIVE; большинство форм ALTER TABLE работают так же.","C":"TRUNCATE берёт ACCESS EXCLUSIVE: пока она работает, таблица недоступна даже для чтения.","D":"Без усечения хвоста VACUUM работает с блокировкой SHARE UPDATE EXCLUSIVE: читать и изменять таблицу при нём можно. Обычный VACUUM в конце работы может ненадолго взять ACCESS EXCLUSIVE, чтобы отрезать пустые страницы в конце таблицы; параметр TRUNCATE false это отключает.","E":"VACUUM FULL перестраивает таблицу и берёт ACCESS EXCLUSIVE: пока он работает, таблица недоступна даже для чтения."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Сеанс 1 в режиме автофиксации выполняет CREATE INDEX ON t (v) на большой таблице, без CONCURRENTLY. Что будет с чтением (SELECT) и записью (INSERT, UPDATE, DELETE) таблицы t в других сеансах, пока строится индекс?', '{"A":"Чтение выполняется, а запись ждёт окончания построения индекса","B":"Чтение и запись выполняются: индекс строится без блокировки таблицы","C":"Чтение ждёт окончания построения, а запись выполняется без ожидания","D":"Чтение и запись ждут: таблица недоступна до окончания построения индекса"}'::jsonb, 'A', 'С CREATE INDEX CONCURRENTLY таблица для записи не блокируется (блокировка SHARE UPDATE EXCLUSIVE), но построение идёт дольше, а саму команду нельзя выполнять внутри блока транзакции.', '{"A":"Блокировка SHARE допускает чтение, но конфликтует с ROW EXCLUSIVE, которую берут INSERT, UPDATE и DELETE. SHARE держится до конца транзакции; в режиме автофиксации она заканчивается вместе с командой.","B":"Обычный CREATE INDEX блокирует изменения таблицы; без блокировки записи строит индекс только вариант CONCURRENTLY.","C":"Наоборот: чтение разрешено, а запись ждёт.","D":"SELECT берёт ACCESS SHARE, совместимую с SHARE: чтение продолжается."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Транзакция в сеансе 1 прочитала таблицу t и не завершена. Сеанс 2 запустил ALTER TABLE t ADD COLUMN c int и ждёт. Сеанс 3 начинает новую транзакцию и впервые обращается к t: SELECT * FROM t. Что будет с этим запросом?', '{"A":"Он завершится ошибкой, потому что таблица заблокирована командой ALTER TABLE","B":"Он встанет в очередь за ALTER TABLE и тоже будет ждать","C":"Он прервёт ожидающий ALTER TABLE и выполнится раньше него","D":"Он выполнится сразу: обычный SELECT берёт совместимую блокировку ACCESS SHARE"}'::jsonb, 'B', 'Поэтому ALTER TABLE на рабочей таблице выполняют с небольшим lock_timeout: если команда не получила блокировку быстро, она завершается ошибкой, не задерживая остальные запросы.', '{"A":"Ошибки нет: запрос ждёт своей очереди, а при заданном lock_timeout — до таймаута.","B":"Запрос ACCESS SHARE встаёт за ранее ожидающим несовместимым ACCESS EXCLUSIVE. Поэтому ожидающий ALTER TABLE задерживает новые чтения, которым ещё нужно получить блокировку таблицы.","C":"Ожидающая команда ничего не прерывает: порядок определяет очередь.","D":"ACCESS SHARE совместима с блокировкой сеанса 1, но в очереди уже стоит ACCESS EXCLUSIVE команды ALTER TABLE, и новый запрос встаёт за ним."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Сеанс ждёт блокировку. Что верно о поиске причины ожидания и об ограничении времени ожидания?', '{"A":"Блокирующий сеанс виден в представлении pg_stat_replication со статусом waiting","B":"В pg_locks у ожидающего сеанса есть строка с granted = false","C":"Увеличение deadlock_timeout заставляет сервер быстрее снимать блокировки","D":"Функция pg_blocking_pids(pid) возвращает номера процессов, блокирующих ожидающий","E":"Заданный заранее lock_timeout = ''2s'' прервёт ожидание блокировки ошибкой через 2 с"}'::jsonb, 'BDE', 'Опыт на двух сеансах: в первом BEGIN; LOCK TABLE t; во втором SET lock_timeout = ''2s''; SELECT * FROM t; — через две секунды ошибка. В третьем: SELECT pid, pg_blocking_pids(pid), wait_event_type FROM pg_stat_activity;', '{"A":"pg_stat_replication описывает процессы отправки WAL и статуса waiting не содержит; ожидание блокировок смотрят в pg_stat_activity, pg_locks и через pg_blocking_pids.","B":"Ожидающий запрос в pg_locks виден по granted = false; в pg_stat_activity у него wait_event_type равен Lock.","C":"deadlock_timeout — время до проверки взаимоблокировки, а не срок удержания блокировок.","D":"Функция принимает номер процесса ожидающего сеанса и возвращает массив номеров процессов, которые его блокируют.","E":"При превышении лимита текущий оператор завершается ошибкой. Параметр задают до запроса: SET для сеанса или SET LOCAL внутри транзакции. Уже ждущий сеанс не выполнит новый SET, пока не закончится текущий запрос."}'::jsonb;

DO $check$
DECLARE candidate record; matches integer;
BEGIN
    FOR candidate IN SELECT * FROM question_seed LOOP
        SELECT count(*) INTO matches FROM questions q
        WHERE regexp_replace(trim(q.question_text), '[[:space:]]+', ' ', 'g') =
              regexp_replace(trim(candidate.question_text), '[[:space:]]+', ' ', 'g');
        IF matches > 1 OR (matches = 1 AND NOT EXISTS (
            SELECT 1 FROM questions q WHERE q.question_text = candidate.question_text
              AND q.category_id = candidate.category_id AND q.options = candidate.options
              AND q.correct_answer = candidate.correct_answer AND q.explanation = candidate.explanation
              AND q.option_notes = candidate.option_notes
        )) THEN
            RAISE EXCEPTION 'Конфликт содержимого или повтор нового вопроса';
        END IF;
    END LOOP;
END
$check$;

INSERT INTO questions(category_id, question_text, options, correct_answer, explanation, option_notes)
SELECT n.* FROM question_seed n
WHERE NOT EXISTS (SELECT 1 FROM questions q WHERE q.question_text = n.question_text);

DO $check$
BEGIN
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 8 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
