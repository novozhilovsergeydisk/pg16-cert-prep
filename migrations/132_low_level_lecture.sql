-- Восемь вопросов раздела «11. Низкоуровневое хранение» по сверке с лекцией: путь pg_relation_filepath и relfilenode после VACUUM FULL, файлы временной таблицы, oid2name, когда создаётся toast-таблица, длинное значение и основной слой, стратегии хранения по умолчанию, EXTERNAL; пояснения к каждому варианту.
-- Источник: scripts/questions/132_low_level_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/storage-file-layout.html
-- https://www.postgresql.org/docs/16/functions-admin.html
-- https://www.postgresql.org/docs/16/sql-vacuum.html
-- https://www.postgresql.org/docs/16/oid2name.html
-- https://www.postgresql.org/docs/16/catalog-pg-class.html
-- https://www.postgresql.org/docs/16/storage-toast.html
-- https://www.postgresql.org/docs/16/sql-altertable.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Таблица t лежит в табличном пространстве pg_default. Запрос SELECT pg_relation_filepath(''t'') вернул base/16384/16392. Что означают части пути?', '{"A":"Каталог pg_default, OID базы, relfilenode таблицы","B":"Каталог pg_default, OID схемы, OID самой таблицы","C":"Каталог данных, OID владельца, номер файла WAL","D":"Каталог кластера, номер сегмента, OID таблицы"}'::jsonb, 'A', 'Последняя часть пути — relfilenode, а не OID таблицы. Сразу после создания они обычно совпадают, но после VACUUM FULL, TRUNCATE или CLUSTER таблица получает новый файл, и relfilenode меняется.', '{"A":"Путь отсчитывается от PGDATA: base — каталог pg_default, 16384 — OID базы, 16392 — relfilenode из pg_class.","B":"Схемы в пути нет: внутри base каталоги называются по OID баз.","C":"Владелец в путь не входит, а журнал лежит в pg_wal.","D":"Номер сегмента дописывается к имени файла через точку, а не отдельным каталогом."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'У таблицы t OID 16385, pg_relation_filepath(''t'') вернула base/16384/16385. После VACUUM FULL t та же функция вернула base/16384/16392. Что произошло?', '{"A":"К файлу таблицы добавился сегмент следующего 1 ГБ","B":"Таблица получила новый OID, а файл остался прежним","C":"Таблицу переписали в новый файл, OID остался прежним","D":"Таблицу перенесли в другое табличное пространство"}'::jsonb, 'C', 'Связь файла и таблицы хранится в pg_class.relfilenode. Поэтому файл в каталоге базы ищут по relfilenode, а не по OID: после перезаписи таблицы они расходятся.', '{"A":"Новый сегмент получил бы имя 16385.1, а не новый номер.","B":"Наоборот: OID прежний, а файл новый.","C":"VACUUM FULL записывает таблицу в новый файл и меняет relfilenode в pg_class; OID таблицы не меняется.","D":"Путь начинается с base, значит таблица осталась в pg_default."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Для временной таблицы pg_relation_filepath вернула base/16384/t2_16400. Что означает префикс t2_?', '{"A":"Второй слой таблицы: карта свободного пространства","B":"Файл временной таблицы сеанса со схемой pg_temp_2","C":"Табличное пространство номер 2 для временных файлов","D":"Второй сегмент файла таблицы с filenode 16400"}'::jsonb, 'B', 'Временные таблицы хранятся так же, как постоянные: основной слой, карта свободного пространства и карта видимости. Отличается только имя файлов, по префиксу видно, какому сеансу они принадлежат.', '{"A":"Слои отличаются суффиксами _fsm, _vm, _init в конце имени.","B":"Буква t отмечает временное отношение, число — номер обслуживающего процесса, тот же, что в имени временной схемы.","C":"Табличное пространство определяет каталог в начале пути, здесь это base.","D":"Номер сегмента дописывается в конце через точку: 16400.1."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Таблицы базы lab не раз переписывали командой VACUUM FULL. В каталоге базы нашли большой файл 16392. Какие команды покажут, какой таблице он принадлежит?', '{"A":"oid2name -d lab -t 16392","B":"SELECT relname FROM pg_class WHERE relfilenode = 16392","C":"SELECT relname FROM pg_class WHERE oid = 16392","D":"oid2name -d lab -f 16392"}'::jsonb, 'BD', 'oid2name — утилита командной строки из contrib. Без ключей она выводит базы и их OID, с -d — таблицы базы и их filenode, с -t ищет по имени, с -o по OID, с -f по filenode.', '{"A":"Ключ -t принимает имя таблицы и показывает её filenode.","B":"Имя файла совпадает с relfilenode таблицы.","C":"После VACUUM FULL OID и relfilenode расходятся, поиск по OID найдёт не ту таблицу или ничего.","D":"Ключ -f ищет таблицу по filenode."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Созданы четыре пустые таблицы. У каких из них сразу появится toast-таблица (reltoastrelid не равен 0)?', '{"A":"a1: id int","B":"a4: id int, n numeric","C":"a3: id int, v text","D":"a2: id int, v varchar(10)"}'::jsonb, 'BC', 'Сервер решает это при CREATE TABLE по типам столбцов, а не по данным: если строка может оказаться больше порога TOAST, около 2 КБ, toast-таблица создаётся сразу. Найти её можно по pg_class.reltoastrelid.', '{"A":"Целое фиксированной длины не бывает длинным, toast-таблица не нужна.","B":"Значение numeric без ограничения точности может быть длинным.","C":"Значение text может быть длинным, поэтому toast-таблица создаётся сразу.","D":"Значение не длиннее 10 символов, строка не может превысить порог TOAST."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'В таблицу t (id int, n numeric) вставили строку, где n содержит около 100 000 цифр. Размер pg_relation_size(''t'') не изменился, а toast-таблица выросла на 48 КБ. Почему?', '{"A":"Значение вынесено в TOAST, а в строке осталась ссылка","B":"Основной слой вырастет после ближайшего VACUUM","C":"Размер основного слоя пересчитается после CHECKPOINT","D":"Значение сжато и поместилось в страницу основного слоя"}'::jsonb, 'A', 'Когда версия строки больше примерно 2 КБ, длинные значения режутся на фрагменты и уходят в toast-таблицу. У numeric стратегия main: сервер сначала пробует сжать значение и выносит его, если сжатие не помогло.', '{"A":"В основной таблице хранится короткий указатель на значение в toast-таблице.","B":"Строка записывается в основной слой сразу, VACUUM для этого не нужен.","C":"pg_relation_size показывает текущий размер файлов, а не значение после контрольной точки.","D":"Тогда не выросла бы toast-таблица."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Таблица создана командой CREATE TABLE t (i int, n numeric, s text, j jsonb). Какие стратегии хранения сервер назначит столбцам по умолчанию?', '{"A":"Столбцу n — стратегию main","B":"Столбцу j — стратегию plain","C":"Столбцу s — стратегию external","D":"Столбцу i — стратегию plain"}'::jsonb, 'AD', 'Стратегию по умолчанию задаёт тип столбца. Посмотреть её можно в столбце Storage вывода \d+ t или в pg_attribute.attstorage, изменить — командой ALTER TABLE ... ALTER COLUMN ... SET STORAGE.', '{"A":"У numeric по умолчанию main: сжатие, вынос в крайнем случае.","B":"У jsonb по умолчанию extended: значение может быть длинным.","C":"У text по умолчанию extended; external задают вручную.","D":"Типы фиксированной длины не сжимаются и не выносятся."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Для столбца s типа text выполнили SET STORAGE EXTERNAL, затем вставили строку длиной 100 символов и строку длиной 10 000 символов. Что верно?', '{"A":"Длинная строка уйдёт в TOAST без сжатия","B":"Обе строки уйдут в TOAST, раз стратегия EXTERNAL","C":"Длинная строка сожмётся и останется в таблице","D":"Короткая строка останется в основной таблице"}'::jsonb, 'AD', 'Проверить можно функциями pg_column_size и pg_column_compression: у длинной строки размер совпадёт с octet_length, а метод сжатия будет NULL. При стратегии extended та же строка из повторяющихся символов сожмётся.', '{"A":"При EXTERNAL сжатие запрещено, значение выносится как есть.","B":"Стратегия разрешает вынос, но короткое значение выносить незачем.","C":"Так могло бы быть при стратегии main, при EXTERNAL сжатия нет.","D":"TOAST включается, только когда строка таблицы больше примерно 2 КБ."}'::jsonb;

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
