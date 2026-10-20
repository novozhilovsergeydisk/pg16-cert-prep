-- Пять вопросов раздела «07. Буферный кеш и журнал» о сбросе журнала и файлов данных на диск с пояснениями к каждому варианту.
-- Источник: scripts/questions/047_fsync_wal.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/runtime-config-wal.html#GUC-FSYNC
-- https://www.postgresql.org/docs/16/runtime-config-wal.html#GUC-WAL-SYNC-METHOD
-- https://man7.org/linux/man-pages/man2/fsync.2.html
-- https://www.postgresql.org/docs/16/pgtestfsync.html
-- https://www.postgresql.org/docs/16/wal-async-commit.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'Что произойдёт, если на сервере PostgreSQL установить fsync = off?', '{"A":"Журнал предзаписи перестанет записываться","B":"Сервер перестанет принудительно сбрасывать данные на диск; после сбоя ОС или питания база может быть повреждена безвозвратно","C":"Будут теряться только последние транзакции, а база останется согласованной","D":"Файлы данных будут сбрасываться вызовом fdatasync вместо fsync"}'::jsonb, 'B', 'Сбой самого PostgreSQL без сбоя ОС не опасен: данные остаются в кеше ядра. Опасен сбой ОС или питания. На рабочем сервере fsync всегда on: SHOW fsync;', '{"A":"Журнал пишется по-прежнему, только без ожидания записи на диск.","B":"Без сброса нет гарантии, что журнал попал на диск раньше изменённых страниц.","C":"Так ведёт себя synchronous_commit = off; при fsync = off возможна порча базы.","D":"Параметр fsync — выключатель всех сбросов, а не выбор вызова."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'К каким файлам относится параметр wal_sync_method?', '{"A":"Ко всем файлам кластера","B":"Только к файлам журнала предзаписи; файлы данных на контрольной точке сбрасываются вызовом fsync","C":"Только к файлам данных таблиц и индексов","D":"К временным файлам сортировки"}'::jsonb, 'B', 'В Linux по умолчанию журнал сбрасывается вызовом fdatasync. Проверка: SHOW wal_sync_method;', '{"A":"Файлы данных сбрасываются отдельно, на контрольной точке.","B":"Название параметра это и говорит: wal — журнал.","C":"Наоборот, только к журналу.","D":"Временные файлы не нужно сохранять после сбоя, их не сбрасывают."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'Чем системный вызов fdatasync отличается от fsync?', '{"A":"fdatasync может не сбрасывать метаданные, не нужные для чтения данных, например время изменения файла","B":"fdatasync работает только для файлов журнала PostgreSQL","C":"fdatasync сбрасывает все открытые файлы процесса","D":"fdatasync не ждёт записи на диск"}'::jsonb, 'A', 'Размер файла fdatasync сбрасывает, потому что без него данные не прочитать. Справка: man 2 fdatasync; сравнить скорость на учебной машине, в отдельном пустом каталоге: /usr/lib/postgresql/16/bin/pg_test_fsync.', '{"A":"Поэтому он может быть быстрее fsync; насколько — зависит от файловой системы и диска.","B":"Это обычный системный вызов Linux, им может пользоваться любая программа.","C":"Оба вызова работают с одним файлом, переданным по номеру.","D":"Успешный вызов в обоих случаях означает, что данные записаны на устойчивый носитель; если вызов вернул -1, гарантии нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'pg_test_fsync при двух записях по 8 КБ показал: open_datasync — 372 операции в секунду, fdatasync — 1338. Почему open_datasync медленнее?', '{"A":"С open_datasync каждая запись сама ждёт сброса на диск, их две; с fdatasync — две записи и один сброс","B":"fdatasync не ждёт записи на диск","C":"Диск не поддерживает open_datasync, и утилита его имитирует","D":"open_datasync сбрасывает весь кеш страниц ОС"}'::jsonb, 'A', 'В приведённом измерении при одной записи 8 КБ результаты близки. pg_test_fsync создаёт файл pg_test_fsync.out и нагружает диск, поэтому её запускают на учебной машине в отдельном пустом каталоге: /usr/lib/postgresql/16/bin/pg_test_fsync.', '{"A":"Это объясняет выигрыш в таком сценарии; его величина зависит от системы. В Linux значение по умолчанию — fdatasync.","B":"fdatasync ждёт, но вызывается один раз на две записи.","C":"Утилита пишет n/a для неподдерживаемых способов, а здесь есть результат.","D":"Флаг O_DSYNC относится только к записям в этот файл."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'Остальные настройки сохранности оставлены по умолчанию. Что верно при сравнении двух отдельных случаев: synchronous_commit = off (при fsync = on) и fsync = off?', '{"A":"Оба параметра одинаково безопасны: теряются только последние транзакции","B":"При synchronous_commit = off после сбоя ОС можно потерять последние подтверждённые транзакции, но база останется согласованной","C":"При fsync = off после сбоя ОС или питания база может оказаться повреждённой","D":"synchronous_commit можно изменить для отдельного сеанса или транзакции","E":"При synchronous_commit = off журнал предзаписи не пишется"}'::jsonb, 'BCD', 'Потеря при synchronous_commit = off ограничена примерно тремя интервалами wal_writer_delay (по умолчанию 200 мс). Проверка: SHOW synchronous_commit; SHOW wal_writer_delay;', '{"A":"fsync = off рискует целостностью всей базы.","B":"Журнал всё равно сбрасывается, только позже, процессом walwriter.","C":"Нарушается порядок «сначала журнал, потом данные» на диске.","D":"Например, SET LOCAL synchronous_commit = off для неважной транзакции.","E":"Журнал пишется; клиент просто не ждёт его сброса на диск."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 5 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
