-- Три вопроса раздела 11 по файлам identity, oid2name -i и SQL-проверке поддержки lz4.
-- Источник: scripts/questions/147_low_level_files.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/functions-info.html
-- https://www.postgresql.org/docs/16/functions-admin.html
-- https://www.postgresql.org/docs/16/oid2name.html
-- https://www.postgresql.org/docs/16/view-pg-config.html
-- https://www.postgresql.org/docs/16/runtime-config-client.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Таблица public.t имеет identity-столбец id. Допишите функцию, чтобы получить путь к файлу связанной последовательности, не угадывая её имя:
```
SELECT pg_relation_filepath(___(''public.t'', ''id''));
```', '{"A":"pg_get_indexdef","B":"pg_sequence_last_value","C":"pg_get_expr","D":"pg_get_serial_sequence"}'::jsonb, 'D', 'pg_get_serial_sequence возвращает имя связанной последовательности и для IDENTITY. Передача этого имени в pg_relation_filepath даёт путь к её основному файлу относительно PGDATA.', '{"A":"Восстанавливает определение индекса, а не имя последовательности.","B":"Эта функция не получает имя последовательности по таблице и столбцу.","C":"Восстанавливает SQL-выражение по его внутреннему представлению.","D":"Возвращает имя последовательности, связанной со столбцом SERIAL или IDENTITY."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Команда oid2name -d practice выводит таблицы базы. Допишите ключ, чтобы включить в список также индексы и последовательности:
```
oid2name -d practice ___
```', '{"A":"-S","B":"-x","C":"-s","D":"-i"}'::jsonb, 'D', 'Утилита oid2name с -d без фильтров выводит таблицы выбранной базы. Ключ -i включает также индексы и последовательности; -S отдельно управляет включением системных объектов.', '{"A":"Включает системные объекты, а не индексы и последовательности пользовательских таблиц.","B":"Добавляет сведения о схеме, табличном пространстве и OID уже выбранных объектов.","C":"Выводит табличные пространства и их OID.","D":"Добавляет индексы и последовательности в список отношений."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '11.'), 'Нужно средствами SQL проверить параметры сборки сервера на наличие --with-lz4. Допишите имя системного представления:
```
SELECT setting FROM ___ WHERE name = ''CONFIGURE'';
```', '{"A":"pg_config","B":"pg_file_settings","C":"pg_available_extensions","D":"pg_settings"}'::jsonb, 'A', 'В представлении pg_config строка CONFIGURE содержит параметры сборки: --with-lz4 означает поддержку lz4. Метод pglz встроен. SHOW default_toast_compression показывает выбранный метод по умолчанию, а не перечень методов, доступных в сборке. Доступ к pg_config по умолчанию ограничен суперпользователями.', '{"A":"Представление содержит параметры сборки работающего сервера, в том числе строку CONFIGURE.","B":"Показывает настройки из конфигурационных файлов, а не параметры компиляции.","C":"Перечисляет доступные SQL-расширения; сжатие lz4 для TOAST не устанавливают через CREATE EXTENSION.","D":"Содержит параметры настройки сервера, но не строку CONFIGURE с параметрами сборки."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 3 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
