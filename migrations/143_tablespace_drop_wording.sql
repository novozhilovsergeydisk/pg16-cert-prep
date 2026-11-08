-- Согласованная редакция одного вопроса темы 10: удаление табличного пространства.
-- Источник итогового текста: scripts/questions/136_tablespaces_lecture.js, вопрос 8.
-- Миграция 136 остаётся неизменной. Архивирование и правка атомарны.
-- Сохраняются id, ключи вариантов, правильные ответы и пояснения. Повторный запуск безопасен.

BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $rewrite$
DECLARE
    old_question constant text := 'Нужно удалить табличное пространство ts. Оно — ТП по умолчанию базы appdb, которую надо сохранить; в нём лежат и таблицы базы cfg. Объектов appdb в pg_default нет. Какие действия подходят для подготовки?';
    new_question constant text := 'Нужно удалить табличное пространство ts, которое используется по умолчанию базой данных appdb. Базу appdb необходимо сохранить. В ts также находятся таблицы базы данных cfg. В пространстве pg_default нет объектов базы данных appdb. Какие действия подходят для подготовки к удалению ts?';
    archive_reason constant text := 'Тема 10: редакция вопроса об удалении табличного пространства (миграция 143)';
    replacements constant jsonb := jsonb_build_object(
        'Узнать базы с объектами в ts через pg_tablespace_databases',
        'Определить базы данных с объектами в ts с помощью pg_tablespace_databases',
        'В cfg перенести или удалить все объекты из ts',
        'В базе данных cfg перенести или удалить все объекты из ts',
        'Сменить ТП базы: ALTER DATABASE appdb SET TABLESPACE pg_default',
        'Изменить табличное пространство базы данных: ALTER DATABASE appdb SET TABLESPACE pg_default',
        'Выполнить DROP TABLESPACE ts CASCADE из любой базы',
        'Выполнить DROP TABLESPACE ts CASCADE из любой базы данных',
        'В appdb хватит ALTER TABLE ALL IN TABLESPACE ts SET TABLESPACE pg_default',
        'В базе данных appdb достаточно выполнить ALTER TABLE ALL IN TABLESPACE ts SET TABLESPACE pg_default'
    );
    matches integer;
    total_options integer;
    distinct_options integer;
    qid integer;
    candidate questions%ROWTYPE;
    archived question_archive%ROWTYPE;
    revised_options jsonb;
    expected_answer text;
BEGIN
    -- Номера вопросов на сервере и локально могут различаться.
    SELECT count(*), min(q.id) INTO matches, qid
    FROM questions q JOIN categories c ON c.id = q.category_id
    WHERE left(c.name, 3) = '10.' AND q.question_text IN (old_question, new_question);
    IF matches <> 1 THEN
        RAISE EXCEPTION 'Не найден единственный вопрос темы 10 для редакции';
    END IF;
    SELECT * INTO STRICT candidate FROM questions WHERE id = qid;

    IF candidate.question_text = old_question THEN
        SELECT count(*), count(DISTINCT o.value), count(*) FILTER (WHERE replacements ? o.value)
        INTO total_options, distinct_options, matches FROM jsonb_each_text(candidate.options) o;
        IF matches <> 5 OR distinct_options <> 5 OR total_options <> 5 THEN
            RAISE EXCEPTION 'Неожиданные варианты исходного вопроса';
        END IF;

        INSERT INTO question_archive
            (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
        SELECT candidate.id, candidate.question_text, candidate.options, candidate.correct_answer,
            candidate.explanation, candidate.option_notes, archive_reason
        WHERE NOT EXISTS (
            SELECT 1 FROM question_archive a
            WHERE a.question_id = candidate.id AND a.reason = archive_reason
        );

        SELECT jsonb_object_agg(o.key, replacements ->> o.value) INTO revised_options
        FROM jsonb_each_text(candidate.options) o;
        UPDATE questions SET question_text = new_question, options = revised_options WHERE id = candidate.id;
    END IF;

    -- Проверка общей для первого и повторного запусков связи с исходным снимком.
    SELECT count(*) INTO matches FROM question_archive a
    WHERE a.question_id = candidate.id AND a.reason = archive_reason;
    IF matches <> 1 THEN RAISE EXCEPTION 'Не найдена единственная архивная версия вопроса'; END IF;
    SELECT * INTO STRICT archived FROM question_archive a
    WHERE a.question_id = candidate.id AND a.reason = archive_reason;
    SELECT * INTO STRICT candidate FROM questions WHERE id = qid;

    SELECT count(*), count(DISTINCT o.value), count(*) FILTER (WHERE replacements ? o.value)
    INTO total_options, distinct_options, matches FROM jsonb_each_text(archived.options) o;
    IF archived.question_text <> old_question OR matches <> 5 OR distinct_options <> 5
        OR total_options <> 5 THEN
        RAISE EXCEPTION 'Неожиданное содержимое архивной версии вопроса';
    END IF;
    SELECT jsonb_object_agg(o.key, replacements ->> o.value) INTO revised_options
    FROM jsonb_each_text(archived.options) o;
    SELECT string_agg(o.key, '' ORDER BY o.key) INTO expected_answer
    FROM jsonb_each_text(archived.options) o
    WHERE o.value IN (
        'Узнать базы с объектами в ts через pg_tablespace_databases',
        'В cfg перенести или удалить все объекты из ts',
        'Сменить ТП базы: ALTER DATABASE appdb SET TABLESPACE pg_default'
    );
    IF candidate.question_text IS DISTINCT FROM new_question
        OR candidate.options IS DISTINCT FROM revised_options
        OR candidate.correct_answer IS DISTINCT FROM archived.correct_answer
        OR candidate.correct_answer IS DISTINCT FROM expected_answer
        OR candidate.explanation IS DISTINCT FROM archived.explanation
        OR candidate.option_notes IS DISTINCT FROM archived.option_notes THEN
        RAISE EXCEPTION 'Редакция изменила ключи, пояснения или не совпала с согласованным текстом';
    END IF;
END
$rewrite$;

COMMIT;
