-- Пять пояснений по полной проверке Codex тем 01–16: буферы clog, последствия без заморозки по курсу и по PostgreSQL 16, гарантия fdatasync, сброс на диск в pg_receivewal, почему реплику не создают из pg_dump.
-- Источник: scripts/questions/060_codex_review_fixes.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('option', 'Где хранятся в памяти последние страницы clog?', 'В общем буферном кеше вместе со страницами таблиц', NULL, 'Буферный кеш хранит страницы таблиц и индексов, у clog свои буферы.', 'Буферный кеш тоже находится в общей памяти, но хранит страницы таблиц и индексов; для clog выделены отдельные буферы.'),
        ('explanation', 'Что произойдёт, если не выполнять заморозку своевременно?', NULL, NULL, 'Уже начатые транзакции могут завершиться, но новые смогут только читать данные. VACUUM при этом работает, им и выполняют заморозку.', 'В курсе это описано как аварийная остановка сервера с обрывом незавершённых транзакций; в PostgreSQL 16 сервер продолжает работать, но отказывается выдавать новые номера транзакций. Уже начатые транзакции могут завершиться, но новые смогут только читать данные. VACUUM при этом работает, им и выполняют заморозку.'),
        ('option', 'Чем системный вызов fdatasync отличается от fsync?', 'fdatasync не ждёт записи на диск', NULL, 'Успешный вызов в обоих случаях означает, что данные записаны на устойчивый носитель; если вызов вернул -1, гарантии нет.', 'Успешный вызов в обоих случаях означает, что данные записаны на устойчивый носитель, если накопитель честно выполняет сброс своего кеша; если вызов вернул -1, гарантии нет.'),
        ('option', 'Чем потоковый архив журналов, который ведёт pg_receivewal, отличается от файлового?', 'Записи пишутся в архив постоянно, не дожидаясь заполнения сегмента', NULL, 'Поэтому задержки минимальны.', 'Поэтому задержки минимальны. Сбрасывать записи на диск сразу, а не при закрытии сегмента, утилита будет с ключом --synchronous.'),
        ('option', 'Из чего создают физическую реплику?', 'Из логической копии, сделанной pg_dump', NULL, 'Логическая копия не годится, так как нужна двоичная совместимость.', 'Логическая копия не годится: реплике нужны те же файлы данных и тот же идентификатор системы, что у основного сервера.')
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
