-- Тема 17, блокировки строк: правки по отчёту Codex (8 исправлений в 4 вопросах), ключи не меняются.
-- Источник: scripts/questions/103_codex_row_locks_fixes.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('question', 'В таблице t первичный ключ id, других уникальных индексов нет. Транзакция A выполнила для строки SELECT … FOR KEY SHARE и не завершилась. Какие действия другой транзакции с этой строкой выполнятся без ожидания?', NULL, NULL, NULL, 'В таблице t первичный ключ id, других уникальных индексов нет. Транзакция A выполнила для строки SELECT … FOR KEY SHARE и не завершилась. Какие действия другой транзакции с этой строкой не будут ждать блокировки A?'),
        ('question', 'Чем блокировка FOR SHARE отличается от FOR KEY SHARE?', NULL, NULL, NULL, 'Чем блокировка FOR SHARE отличается от FOR KEY SHARE для действий других транзакций?'),
        ('option', 'Какую блокировку строки берёт команда DELETE?', 'FOR UPDATE', NULL, 'Удаление требует самого сильного режима: он несовместим со всеми остальными.', 'Удаление требует самого сильного режима: он конфликтует с любой блокировкой этой строки в другой транзакции, включая FOR UPDATE.'),
        ('explanation', 'В дочернюю таблицу вставляют строку со ссылкой на родительскую. В каком режиме проверка внешнего ключа блокирует родительскую строку?', NULL, NULL, 'Проверка внешнего ключа выполняет для родительской строки запрос с FOR KEY SHARE. Пока вставляющая транзакция не завершится, родительскую строку нельзя удалить или изменить её ключ, но неключевые столбцы менять можно.', 'Проверка внешнего ключа выполняет для родительской строки запрос с FOR KEY SHARE. До конца транзакции другие транзакции не могут удалить эту строку или изменить её ключ, но неключевые столбцы менять могут. Для отложенного внешнего ключа блокировка появляется в момент проверки, а не при вставке.'),
        ('option', 'В дочернюю таблицу вставляют строку со ссылкой на родительскую. В каком режиме проверка внешнего ключа блокирует родительскую строку?', 'FOR NO KEY UPDATE', NULL, 'Так блокирует строку UPDATE, а не проверка внешнего ключа.', 'Так блокирует строку UPDATE, не меняющий ключевые столбцы, а не проверка внешнего ключа.'),
        ('option', 'В таблице t первичный ключ id, других уникальных индексов нет. Транзакция A выполнила для строки SELECT … FOR KEY SHARE и не завершилась. Какие действия другой транзакции с этой строкой не будут ждать блокировки A?', 'UPDATE, меняющий неключевой столбец', 'UPDATE неключевого столбца без смены id', NULL, NULL),
        ('explanation', 'В таблице t первичный ключ id, других уникальных индексов нет. Транзакция A выполнила для строки SELECT … FOR KEY SHARE и не завершилась. Какие действия другой транзакции с этой строкой не будут ждать блокировки A?', NULL, NULL, 'FOR KEY SHARE конфликтует только с FOR UPDATE: он защищает строку от удаления и от изменения ключа, но разрешает обычные UPDATE и другие разделяемые блокировки.', 'FOR KEY SHARE конфликтует только с FOR UPDATE: он защищает строку от удаления и от изменения ключа, но разрешает UPDATE неключевых столбцов (FOR NO KEY UPDATE) и другие разделяемые блокировки.'),
        ('explanation', 'Чем блокировка FOR SHARE отличается от FOR KEY SHARE для действий других транзакций?', NULL, NULL, 'Оба режима разделяемые и запрещают удаление строки и изменение ключа. FOR SHARE строже: он запрещает и обычный UPDATE. FOR KEY SHARE пропускает UPDATE, не меняющий ключевые столбцы, поэтому его и использует проверка внешнего ключа.', 'Оба режима разделяемые и запрещают удаление строки и изменение ключа. FOR SHARE строже: он не пропускает и UPDATE неключевых столбцов. FOR KEY SHARE пропускает UPDATE, не меняющий ключевые столбцы, поэтому его и использует проверка внешнего ключа.')
    ) AS fixes(kind, question_text, opt_text, new_opt_text, old_text, new_text)
    LOOP
        -- Сначала ровно один вопрос по тексту (прежнему или новому), дальше всё только по его id.
        SELECT count(*), min(id) INTO matches, qid FROM questions
        WHERE question_text IN (fix.question_text, CASE WHEN fix.kind = 'question' THEN fix.new_text ELSE fix.question_text END);
        IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вопрос для исправления'; END IF;
        IF fix.kind = 'question' THEN
            UPDATE questions SET question_text = fix.new_text WHERE id = qid;
        ELSIF fix.kind = 'explanation' THEN
            PERFORM 1 FROM questions WHERE id = qid AND explanation IN (fix.old_text, fix.new_text);
            IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение вопроса'; END IF;
            UPDATE questions SET explanation = fix.new_text WHERE id = qid;
        ELSE
            SELECT count(*), min(o.key) INTO matches, k
            FROM questions q, jsonb_each_text(q.options) o
            WHERE q.id = qid AND o.value IN (fix.opt_text, coalesce(fix.new_opt_text, fix.opt_text));
            IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вариант ответа для исправления'; END IF;
            IF fix.new_text IS NOT NULL THEN
                PERFORM 1 FROM questions WHERE id = qid AND option_notes ->> k IN (fix.old_text, fix.new_text);
                IF NOT FOUND THEN RAISE EXCEPTION 'Неожиданное пояснение варианта'; END IF;
                UPDATE questions SET option_notes = jsonb_set(option_notes, ARRAY[k], to_jsonb(fix.new_text)) WHERE id = qid;
            END IF;
            IF fix.new_opt_text IS NOT NULL THEN
                UPDATE questions SET options = jsonb_set(options, ARRAY[k], to_jsonb(fix.new_opt_text)) WHERE id = qid;
            END IF;
        END IF;
    END LOOP;
END
$fix$;

COMMIT;
