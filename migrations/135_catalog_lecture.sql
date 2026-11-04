-- Девять вопросов раздела «09. Системный каталог» по сверке с лекцией: отношения в pg_class после CREATE TABLE, relpersistence, временные таблицы и очистка каталога, подзапрос по relname и regclass, regtype, pg_get_catalog_foreign_keys, \sf, определение представления, уникальность oid; пояснения к каждому варианту.
-- Источник: scripts/questions/135_catalog_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/catalog-pg-class.html
-- https://www.postgresql.org/docs/16/sql-createtable.html
-- https://www.postgresql.org/docs/16/routine-vacuuming.html
-- https://www.postgresql.org/docs/16/datatype-oid.html
-- https://www.postgresql.org/docs/16/catalog-pg-attribute.html
-- https://www.postgresql.org/docs/16/functions-info.html
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/catalog-pg-depend.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'Выполнили CREATE TABLE app.emp (id serial PRIMARY KEY, name text). Какие отношения этой команды появятся в pg_class в схеме app?', '{"A":"Последовательность emp_id_seq с relkind = S","B":"Toast-таблица для name с relkind = t","C":"Индекс emp_pkey с relkind = i","D":"Таблица emp с relkind = r"}'::jsonb, 'ACD', 'В pg_class описаны все отношения: таблицы (r), индексы (i), последовательности (S), представления (v), toast-таблицы (t) и другие. Вид отношения показывает relkind, схему — relnamespace. Toast-таблица pg_toast_ с OID таблицы в имени и её индекс лежат в схеме pg_toast.', '{"A":"serial создаёт последовательность для значений id.","B":"Она тоже появится в pg_class, но в схеме pg_toast, а не app.","C":"Первичный ключ создаёт уникальный индекс.","D":"Сама таблица; r — обычная таблица."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'В pg_class две таблицы sal: у одной relpersistence = p, у другой t. Что это значит?', '{"A":"Первая обычная, вторая создана как UNLOGGED","B":"Первая постоянная, вторая временная таблица сеанса","C":"Первая в табличном пространстве pg_default, вторая в другом","D":"Первая секционированная, вторая её секция"}'::jsonb, 'B', 'relpersistence различает постоянные (p), нежурналируемые (u) и временные (t) отношения. Имя временной таблицы может совпадать с постоянной: они лежат в разных схемах.', '{"A":"У таблицы UNLOGGED relpersistence = u. Данные временной таблицы тоже не пишутся в WAL, но она отмечается буквой t.","B":"p — permanent, t — temporary; временная таблица лежит в схеме pg_temp_N своего сеанса.","C":"Табличное пространство хранится в reltablespace, а не в relpersistence.","D":"Секционированную таблицу отличает relkind = p, а секцию — relispartition."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'Приложение на каждый запрос создаёт и удаляет временную таблицу, тысячи раз в минуту. Что происходит в системном каталоге базы?', '{"A":"В pg_class и pg_attribute копятся мёртвые версии строк","B":"Каталог не меняется: временная таблица описана в памяти сеанса","C":"Строки каталога удаляются сразу, без мёртвых версий","D":"Описание пишется в схему pg_temp и не требует очистки"}'::jsonb, 'A', 'CREATE TEMP TABLE добавляет строки в таблицы каталога, а DROP TABLE оставляет их мёртвые версии. Сколько их накопится, зависит от структуры таблицы: 300 циклов с таблицей (a int, b text) до очистки оставили в pg_attribute около 5700 мёртвых строк, в pg_class около 900. При частом создании и удалении временных таблиц следят, успевает ли очистка обрабатывать каталог, иначе его таблицы разбухают.', '{"A":"Создание добавляет строки в таблицы каталога, удаление оставляет их мёртвые версии. Их убирает очистка.","B":"Описание временной таблицы пишется в обычные таблицы каталога базы, как у постоянной.","C":"DROP TABLE удаляет строки каталога по правилам MVCC, как обычный DELETE.","D":"В pg_temp_N лежат сами временные таблицы, а их описание — в общих для базы pg_class и pg_attribute."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'Запрос SELECT attname FROM pg_attribute WHERE attrelid = (SELECT oid FROM pg_class WHERE relname = ''emp'') завершился ошибкой «подзапрос в выражении вернул больше одной строки». В чём причина?', '{"A":"Подзапрос видит в pg_class старые версии строки emp","B":"Таблица emp секционирована, строк по числу секций","C":"В разных схемах есть отношения с именем emp","D":"У emp есть toast-таблица с тем же relname"}'::jsonb, 'C', 'Надёжнее привести имя к regclass: attrelid = ''emp''::regclass. Имя ищется по search_path, как в обычном запросе, а схему можно указать явно: ''app.emp''::regclass. Если таблицы нет, приведение сразу даст ошибку.', '{"A":"Снимок показывает одну версию строки, мёртвые версии запросу не видны.","B":"Секции — отдельные отношения со своими именами. Если секция в другой схеме тоже названа emp, причина всё равно в совпадении имён.","C":"pg_class хранит таблицы, представления, индексы и другие отношения. Имя отношения уникально в пределах схемы, а запрос не ограничивает ни схему, ни вид отношения.","D":"Toast-таблица называется pg_toast_ с OID таблицы, например pg_toast_16450."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'Допишите запрос, чтобы вместо чисел 23 и 25 вывести имена типов integer и text:
```
SELECT attname, atttypid::___
FROM pg_attribute
WHERE attrelid = ''emp''::regclass AND attnum > 0;
```', '{"A":"`text`","B":"`regtype`","C":"`regproc`","D":"`regclass`"}'::jsonb, 'B', 'Типы reg* — псевдонимы oid: при выводе они показывают имя объекта из своей таблицы каталога. regtype — для pg_type, regclass — для pg_class, regproc — для pg_proc.', '{"A":"Приведение oid к text даёт то же число в виде строки.","B":"Приведение oid к regtype выводит имя типа из pg_type.","C":"regproc ищет имя в pg_proc; функции с таким OID нет, выведется число.","D":"regclass ищет имя в pg_class; отношения с OID 23 нет, поэтому выведется число."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'В таблицах системного каталога нет ограничений FOREIGN KEY. Как в PostgreSQL 16 узнать, на какие таблицы ссылаются столбцы pg_attribute?', '{"A":"SELECT * FROM information_schema.referential_constraints","B":"Командой \\d pg_attribute в psql","C":"SELECT * FROM pg_constraint WHERE contype = ''f''","D":"SELECT * FROM pg_get_catalog_foreign_keys()"}'::jsonb, 'D', 'Ссылочную целостность каталога поддерживает код сервера, а не ограничения. Функция возвращает для каждой ссылки таблицу и столбцы, таблицу и столбцы, на которые они ссылаются, и признаки is_array и is_opt (ссылка может быть нулевой).', '{"A":"Представление строится по pg_constraint и тоже не покажет связей каталога.","B":"Команда покажет первичный ключ и ограничение уникальности, а внешних ключей в выводе не будет.","C":"В pg_constraint только настоящие внешние ключи, у таблиц каталога их нет.","D":"Функция появилась в 14-й версии и перечисляет ссылки между таблицами каталога: attrelid ведёт в pg_class, atttypid в pg_type."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'В схеме app одна функция calc, она написана на SQL. Какая команда psql покажет её определение в виде CREATE OR REPLACE FUNCTION?', '{"A":"\\d+ app.calc","B":"\\dfS app.calc","C":"\\df+ app.calc","D":"\\sf app.calc"}'::jsonb, 'D', 'Тело SQL-функции, заданное строкой, хранится в pg_proc.prosrc, а тело в стандартной записи (BEGIN ATOMIC или RETURN) — в разобранном виде в prosqlbody. У PL/pgSQL тело лежит в prosrc. \sf восстанавливает полное определение функции, \ef открывает его в редакторе.', '{"A":"Команда \\d без буквы вида описывает отношения, функцию так не найти.","B":"Модификатор S добавляет к списку системные функции, текста функции нет.","C":"Покажет язык, владельца, изменчивость и права, но не текст функции.","D":"Команда собирает определение функции из pg_proc: параметры, атрибуты и тело."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'Как увидеть запрос, на котором построено представление app.top?', '{"A":"\\d+ app.top","B":"SELECT pg_get_viewdef(''app.top''::regclass)","C":"\\dv+ app.top","D":"SELECT prosrc FROM pg_proc WHERE proname = ''top''"}'::jsonb, 'AB', 'Представление хранится в каталоге как правило перезаписи в pg_rewrite. И \d+, и pg_get_viewdef восстанавливают из него текст запроса; в psql это видно при \set ECHO_HIDDEN on.', '{"A":"В выводе есть раздел «Определение представления».","B":"Функция восстанавливает SELECT представления по его OID.","C":"Покажет строку списка: схему, владельца, размер и описание, но не запрос.","D":"В pg_proc хранятся функции; запрос представления лежит в правиле перезаписи в pg_rewrite."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '09.'), 'В pg_class и pg_type нашлись строки с одинаковым oid. Что верно?', '{"A":"Счётчик oid 32-битный и после исчерпания идёт по кругу","B":"Одна из строк — мёртвая версия, её уберёт очистка","C":"Так бывает: oid уникален в пределах одной таблицы каталога","D":"Каталог повреждён: oid уникален во всём кластере"}'::jsonb, 'AC', 'Новые oid выдаются из общего для кластера счётчика, поэтому совпадения редки, но возможны: 32 бит недостаточно для уникальности во всей базе. Поэтому объект каталога адресуют парой: таблица каталога и oid, как в pg_depend (classid, objid); для столбца добавляется objsubid — номер столбца.', '{"A":"Около 4 млрд значений; после переполнения сервер пропускает oid, уже занятые в этой таблице.","B":"Мёртвые версии не видны запросу; обе строки живые и описывают разные объекты.","C":"В pg_class и pg_type уникальность oid обеспечивают отдельные уникальные индексы, поэтому совпадение oid в этих двух каталогах допустимо.","D":"Счётчик общий для кластера, но гарантия уникальности есть только внутри таблицы каталога."}'::jsonb;

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
