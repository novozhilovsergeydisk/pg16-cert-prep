-- Проверка Codex набора 132 по теме 11: 2 вопроса (3 исправления), ключи не меняются.
-- Источник: scripts/questions/134_codex_topic11_set132.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('option', 'Для временной таблицы pg_relation_filepath вернула base/16384/t2_16400. Что означает префикс t2_?', 'Файл временной таблицы сеанса со схемой pg_temp_2', NULL, 'Буква t отмечает временное отношение, число — номер обслуживающего процесса, тот же, что в имени временной схемы.', 'Буква t отмечает временное отношение, 2 — внутренний номер обслуживающего процесса (BackendId), а не PID в ОС. Тот же номер стоит в имени временной схемы сеанса pg_temp_2.'),
        ('question', 'Для столбца s типа text выполнили SET STORAGE EXTERNAL, затем вставили строку длиной 100 символов и строку длиной 10 000 символов. Что верно?', NULL, NULL, NULL, 'Таблица t (s text) создана с параметрами по умолчанию. Выполнили ALTER TABLE t ALTER COLUMN s SET STORAGE EXTERNAL и вставили две строки: repeat(''a'', 100) и repeat(''a'', 10000). Что верно?'),
        ('option', 'Таблица t (s text) создана с параметрами по умолчанию. Выполнили ALTER TABLE t ALTER COLUMN s SET STORAGE EXTERNAL и вставили две строки: repeat(''a'', 100) и repeat(''a'', 10000). Что верно?', 'Обе строки уйдут в TOAST, раз стратегия EXTERNAL', NULL, 'Стратегия разрешает вынос, но короткое значение выносить незачем.', 'EXTERNAL разрешает вынос без сжатия, но строка со значением из 100 символов меньше порога TOAST и остаётся в основной таблице.')
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
