-- Девять вопросов раздела «10. Табличные пространства» по сверке с лекцией: пустой tablespace в pg_tables, default_tablespace, temp_tablespaces, блокировка при SET TABLESPACE, REINDEX (TABLESPACE), ALTER TABLE ALL IN TABLESPACE, размер ТП с каталогом базы, освобождение ТП перед DROP TABLESPACE, ошибка ALTER DATABASE SET TABLESPACE; пояснения к каждому варианту.
-- Источник: scripts/questions/136_tablespaces_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/view-pg-tables.html
-- https://www.postgresql.org/docs/16/catalog-pg-class.html
-- https://www.postgresql.org/docs/16/runtime-config-client.html
-- https://www.postgresql.org/docs/16/sql-altertable.html
-- https://www.postgresql.org/docs/16/explicit-locking.html
-- https://www.postgresql.org/docs/16/sql-reindex.html
-- https://www.postgresql.org/docs/16/functions-admin.html
-- https://www.postgresql.org/docs/16/manage-ag-tablespaces.html
-- https://www.postgresql.org/docs/16/functions-info.html
-- https://www.postgresql.org/docs/16/sql-droptablespace.html
-- https://www.postgresql.org/docs/16/sql-alterdatabase.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'База appdb создана с TABLESPACE ts. В pg_tables у таблицы t1 столбец tablespace пустой, у t2 — pg_default. Где лежат файлы t1?', '{"A":"В ts, табличном пространстве по умолчанию базы","B":"В pg_default, как у большинства баз кластера","C":"В pg_global, вместе с системным каталогом","D":"Нигде: файлы появятся после первой вставки"}'::jsonb, 'A', 'Если таблица лежит в ТП по умолчанию своей базы, в pg_class.reltablespace записывается 0, и pg_tables показывает пустое значение. Так же записывается таблица, созданная при default_tablespace, совпадающем с ТП базы.', '{"A":"Пустое значение означает ТП по умолчанию базы: в pg_class у такой таблицы reltablespace = 0.","B":"Без TABLESPACE база получает ТП шаблона, обычно template1, а у appdb явно задано ts.","C":"В pg_global лежат общие объекты каталога кластера, а каталог базы — в её ТП по умолчанию.","D":"Файл основного слоя создаётся сразу при CREATE TABLE, у пустой таблицы тоже."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'В базе appdb (ТП по умолчанию pg_default) выполнили SET default_tablespace = ts (ТП ts существует, право CREATE на него есть), затем CREATE TABLE t (id int) без TABLESPACE. Где окажется таблица?', '{"A":"В pg_default: ТП базы важнее параметра сеанса","B":"В ts: параметр задаёт ТП для новых объектов","C":"В pg_default до переподключения к базе","D":"В ts, а будущие индексы — в pg_default"}'::jsonb, 'B', 'Пустое значение default_tablespace означает ТП по умолчанию базы. Для временных таблиц и временных файлов действует не он, а temp_tablespaces.', '{"A":"Наоборот: параметр сеанса важнее ТП по умолчанию базы.","B":"default_tablespace действует на таблицы и индексы, созданные без TABLESPACE.","C":"SET действует сразу, в текущем сеансе.","D":"Индексы, созданные без TABLESPACE, тоже попадут в ts, в том числе индекс первичного ключа."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'В сеансе выполнили SET temp_tablespaces = ts1, ts2 и создали несколько временных таблиц без явного TABLESPACE. Что верно?', '{"A":"Временные файлы сортировок тоже лягут в ts1 или ts2","B":"Постоянные таблицы сеанса тоже создадутся в ts1 или ts2","C":"Каждая таблица создастся в ts1 или в ts2","D":"Все таблицы создадутся в ts1, пока там есть место"}'::jsonb, 'AC', 'Пустой temp_tablespaces означает ТП по умолчанию текущей базы. При нескольких ТП сервер выбирает одно случайно, а следующие временные объекты той же транзакции кладёт по очереди. В опыте шесть таблиц, созданных отдельными командами, распределились случайно, четыре в одном блоке BEGIN … COMMIT — поочерёдно.', '{"A":"Параметр задаёт место и для временных таблиц, и для временных файлов сортировки и хеширования.","B":"Для постоянных объектов действует default_tablespace, а не temp_tablespaces.","C":"Для каждого нового временного объекта сервер выбирает пространство из списка; внутри одной транзакции — по очереди.","D":"Сервер не заполняет пространства по очереди до конца, а выбирает для каждого объекта; свободное место не учитывается."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'Таблицу orders размером 200 ГБ переносят командой ALTER TABLE orders SET TABLESPACE archive. Команда уже получила блокировку и копирует данные. Что верно?', '{"A":"Чтение продолжается, а INSERT и UPDATE ждут","B":"SELECT из других сеансов ждут снятия блокировки","C":"Меняется запись в каталоге, данные остаются на месте","D":"Файлы таблицы копируются в ТП archive"}'::jsonb, 'BD', 'Индексы таблицы при этом остаются на месте, их переносят отдельно: ALTER INDEX ... SET TABLESPACE или REINDEX с параметром TABLESPACE. Перенос большой таблицы планируют на окно обслуживания.', '{"A":"ACCESS EXCLUSIVE конфликтует со всеми режимами, в том числе с ACCESS SHARE у SELECT.","B":"Команда держит ACCESS EXCLUSIVE, она несовместима даже с чтением. Блокировка снимается в конце транзакции, а не сразу по окончании копирования.","C":"Так работает SET SCHEMA, а SET TABLESPACE переписывает файлы.","D":"Это физический перенос данных, длительность зависит от размера таблицы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'Допишите команду, чтобы перестроить индекс orders_idx и сразу разместить его в табличном пространстве fast:
```
REINDEX (___ fast) INDEX orders_idx;
```', '{"A":"`MOVE`","B":"`SET TABLESPACE`","C":"`LOCATION`","D":"`TABLESPACE`"}'::jsonb, 'D', 'REINDEX с параметром TABLESPACE строит индекс заново сразу в новом пространстве. ALTER INDEX ... SET TABLESPACE копирует файлы индекса без перестройки.', '{"A":"Такого параметра у REINDEX нет.","B":"SET TABLESPACE — форма ALTER TABLE и ALTER INDEX, а не параметр REINDEX.","C":"LOCATION задаёт каталог в CREATE TABLESPACE, у REINDEX такого параметра нет.","D":"Параметр TABLESPACE у REINDEX появился в 14-й версии."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'В базе appdb выполнили ALTER TABLE ALL IN TABLESPACE ts SET TABLESPACE pg_default. Что переедет в pg_default?', '{"A":"Таблицы appdb из ts вместе с их индексами","B":"Все объекты appdb из ts, включая системный каталог","C":"Таблицы appdb из ts вместе с их toast-таблицами","D":"Таблицы и индексы всех баз, лежащие в ts"}'::jsonb, 'C', 'Команда сначала получает блокировки всех переносимых таблиц, затем переносит их по одной. OWNED BY ограничивает перенос таблицами указанных ролей, с NOWAIT команда сразу завершится ошибкой, если какую-то блокировку не получить.', '{"A":"Индексы таблиц остаются в своих ТП; для массового переноса индексов есть ALTER INDEX ALL IN TABLESPACE.","B":"Таблицы каталога эта команда не переносит, для этого есть ALTER DATABASE ... SET TABLESPACE.","C":"Команда переносит таблицы текущей базы; toast-таблица переезжает вместе со своей таблицей.","D":"Команда работает в текущей базе; объекты других баз переносят, подключившись к ним."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'База appdb создана с TABLESPACE ts, в ней две пустые таблицы. pg_tablespace_size(''ts'') показывает около 7 МБ. Откуда этот объём?', '{"A":"Так выглядят файлы WAL этих двух таблиц","B":"Сервер заранее резервирует место под новые таблицы","C":"В ts лежит системный каталог базы appdb","D":"В размер ТП входит копия общего каталога pg_global"}'::jsonb, 'C', 'Поэтому, чтобы освободить ТП и сохранить базу, её переносят командой ALTER DATABASE ... SET TABLESPACE. Размер всех ТП показывает и команда \db+.', '{"A":"Журнал лежит в PGDATA/pg_wal и в размер ТП не входит.","B":"Файлы таблиц растут по мере записи, заранее место не выделяется.","C":"Каталог базы хранится в её ТП по умолчанию и уже у пустой базы занимает несколько мегабайт.","D":"Общие объекты каталога лежат в PGDATA/global и не копируются в другие ТП."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'Нужно удалить табличное пространство ts. Оно — ТП по умолчанию базы appdb, которую надо сохранить; в нём лежат и таблицы базы cfg. Объектов appdb в pg_default нет. Какие действия подходят для подготовки?', '{"A":"Сменить ТП базы: ALTER DATABASE appdb SET TABLESPACE pg_default","B":"Выполнить DROP TABLESPACE ts CASCADE из любой базы","C":"В appdb хватит ALTER TABLE ALL IN TABLESPACE ts SET TABLESPACE pg_default","D":"В cfg перенести или удалить все объекты из ts","E":"Узнать базы с объектами в ts через pg_tablespace_databases"}'::jsonb, 'ADE', 'DROP TABLESPACE удаляет пространство, только когда в нём нет объектов ни одной базы. Порядок из демонстрации курса: pg_tablespace_databases, затем перенос или удаление объектов в каждой базе, для базы с ТП по умолчанию ts — ALTER DATABASE ... SET TABLESPACE из другой базы, потом DROP TABLESPACE.', '{"A":"Команду выполняют из другой базы вне блока транзакции, когда к appdb нет подключений. Она переносит в pg_default всё из прежнего ТП базы, включая системный каталог.","B":"У DROP TABLESPACE нет CASCADE: пространство удаляется, только когда в нём нет объектов ни одной базы.","C":"Это перенесёт таблицы appdb, но не её индексы и каталог, а таблицы cfg останутся.","D":"Индексы переносят отдельно от таблиц, при удалении таблицы они удаляются вместе с ней. Перед DROP TABLESPACE в ts не должно остаться объектов других баз.","E":"Функция возвращает OID баз, у которых есть объекты в этом ТП."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '10.'), 'ТП по умолчанию базы appdb — ts. Команда ALTER DATABASE appdb SET TABLESPACE pg_default завершилась ошибкой «некоторые отношения базы данных appdb уже находятся в табличном пространстве pg_default». Подключений к appdb нет. Что делать?', '{"A":"Вернуть эти отношения в текущее ТП базы и повторить","B":"Повторить команду, когда завершатся сеансы в appdb","C":"Добавить к команде CASCADE, чтобы перенести их тоже","D":"Удалить из pg_default каталог с OID базы appdb"}'::jsonb, 'A', 'В appdb вернуть отношения командами ALTER TABLE ALL, ALTER INDEX ALL и ALTER MATERIALIZED VIEW ALL IN TABLESPACE pg_default SET TABLESPACE ts. Затем отключиться от appdb и повторить ALTER DATABASE из другой базы. В опыте после этого команда прошла, и DROP TABLESPACE удалил опустевшее пространство.', '{"A":"Команда переносит всё из старого ТП по умолчанию, и в новом не должно быть отношений этой базы. После возврата они переедут вместе с остальными.","B":"Сеансы дали бы другую ошибку: база занята другими пользователями.","C":"У ALTER DATABASE ... SET TABLESPACE нет CASCADE.","D":"Править файлы вручную нельзя: в каталоге лежат действующие отношения базы."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 9 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
