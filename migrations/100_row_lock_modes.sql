-- Четыре вопроса к теме 17 (вне экзамена): режимы блокировок строк FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE, какие команды их берут и как они совместимы; пояснения к каждому варианту.
-- Источник: scripts/questions/100_row_lock_modes.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS
-- https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE
-- https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '17.'), 'Какую блокировку строки берёт команда DELETE?', '{"A":"FOR NO KEY UPDATE","B":"FOR SHARE","C":"FOR KEY SHARE","D":"FOR UPDATE"}'::jsonb, 'D', 'DELETE и UPDATE, меняющий ключевые столбцы (первичного ключа или уникального индекса, на который может ссылаться внешний ключ), берут блокировку FOR UPDATE. Остальные UPDATE берут более слабую FOR NO KEY UPDATE, чтобы не мешать проверкам внешних ключей.', '{"A":"Этот режим берёт UPDATE, который не меняет ключевые столбцы.","B":"Разделяемый режим для чтения: он сам запрещает изменять и удалять строку.","C":"Самый слабый режим: его берёт проверка внешнего ключа, и он сам запрещает удаление.","D":"Удаление требует самого сильного режима: он несовместим со всеми остальными."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '17.'), 'В дочернюю таблицу вставляют строку со ссылкой на родительскую. В каком режиме проверка внешнего ключа блокирует родительскую строку?', '{"A":"FOR NO KEY UPDATE","B":"FOR KEY SHARE","C":"FOR SHARE","D":"FOR UPDATE"}'::jsonb, 'B', 'Проверка внешнего ключа выполняет для родительской строки запрос с FOR KEY SHARE. Пока вставляющая транзакция не завершится, родительскую строку нельзя удалить или изменить её ключ, но неключевые столбцы менять можно.', '{"A":"Так блокирует строку UPDATE, а не проверка внешнего ключа.","B":"Проверке нужно лишь, чтобы строка и её ключ не исчезли до конца транзакции.","C":"Этот режим запретил бы и изменение неключевых столбцов, поэтому проверка берёт более слабый.","D":"Этот режим помешал бы даже изменению неключевых столбцов родительской строки."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '17.'), 'В таблице t первичный ключ id, других уникальных индексов нет. Транзакция A выполнила для строки SELECT … FOR KEY SHARE и не завершилась. Какие действия другой транзакции с этой строкой выполнятся без ожидания?', '{"A":"SELECT … FOR SHARE этой строки","B":"DELETE этой строки по первичному ключу","C":"UPDATE, меняющий неключевой столбец","D":"UPDATE, меняющий значение первичного ключа"}'::jsonb, 'AC', 'FOR KEY SHARE конфликтует только с FOR UPDATE: он защищает строку от удаления и от изменения ключа, но разрешает обычные UPDATE и другие разделяемые блокировки.', '{"A":"Разделяемые режимы совместимы друг с другом.","B":"Удаление берёт FOR UPDATE и ждёт: FOR KEY SHARE запрещает удалять строку.","C":"Он берёт FOR NO KEY UPDATE, а этот режим совместим с FOR KEY SHARE.","D":"Изменение ключа берёт FOR UPDATE и ждёт завершения A."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '17.'), 'Чем блокировка FOR SHARE отличается от FOR KEY SHARE?', '{"A":"FOR SHARE не даёт менять и неключевые столбцы","B":"FOR KEY SHARE не мешает удалить эту строку","C":"FOR KEY SHARE ждёт завершения чужого FOR SHARE","D":"FOR SHARE несовместим с другим FOR SHARE"}'::jsonb, 'A', 'Оба режима разделяемые и запрещают удаление строки и изменение ключа. FOR SHARE строже: он запрещает и обычный UPDATE. FOR KEY SHARE пропускает UPDATE, не меняющий ключевые столбцы, поэтому его и использует проверка внешнего ключа.', '{"A":"FOR SHARE конфликтует с FOR NO KEY UPDATE, то есть с обычным UPDATE; FOR KEY SHARE с ним совместим.","B":"Мешает: DELETE берёт FOR UPDATE, а с ним FOR KEY SHARE несовместим.","C":"Не ждёт: эти режимы совместимы.","D":"Совместим: несколько транзакций могут одновременно держать FOR SHARE на одной строке."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 4 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
