-- Уточнить условия двух вопросов набора 140: согласованность копии и исходная линия времени.
-- Источник: scripts/questions/144_backup_conditions.js; варианты и пояснения из набора 140.
-- https://www.postgresql.org/docs/16/continuous-archiving.html
-- Архивирование и правка атомарны; ключи вариантов и ответов сохраняются.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;
DO $rewrite$
DECLARE fix record; candidate questions%ROWTYPE; archived question_archive%ROWTYPE;
        matches integer; expected_answer text;
        archive_reason constant text := 'Тема 14: условия восстановления (миграция 144)';
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('Архив ведёт pg_receivewal. Базовую копию сняли раньше, сегменты после неё до …04 в архиве заполнены, последний — 000000010000000000000005.partial. Копию восстанавливают с recovery.signal и restore_command = ''cp /archive/%f %p''. Что будет с изменениями из …05?', 'Базовая копия завершилась в сегменте …04. Архив pg_receivewal содержит весь WAL от начала копии до …04 и последний файл 000000010000000000000005.partial. Копию восстанавливают с recovery.signal и restore_command = ''cp /archive/%f %p'', без целевой точки; в pg_wal сегмента …05 нет. Что будет с изменениями из …05?', 'Последний недописанный файл копируют под именем сегмента, например в pg_wal восстанавливаемого сервера: в опыте после этого восстановились и база, и таблица. Это совет к практике+ курса.', '[["Потеряются, если не переименовать .partial",true,"restore_command ищет файл по имени сегмента без суффикса: в опыте восстановление закончилось на …04, а созданной позже базы не оказалось."],["Применятся: restore_command возьмёт .partial",false,"Команда копирует файл с именем %f, а имя файла .partial с ним не совпадает."],["Сервер не запустится, пока не найдёт …05",false,"Согласованность уже достигнута на …04, поэтому сервер завершает восстановление на последней найденной записи и переходит в обычный режим."],["Подтянутся из pg_wal основного сервера",false,"restore_command берёт файлы из указанного места, к основному серверу восстановление из архива не подключается."]]'),
        ('Сервер восстановили из базовой копии и архива WAL с recovery.signal, без целевой точки. Он применил все сегменты архива и перешёл в обычный режим. Что верно?', 'Базовая копия и архив WAL относятся к линии времени 1; других линий в архиве нет. Сервер восстановили с recovery.signal, без целевой точки: он применил весь архив и перешёл в обычный режим. Что верно?', 'Без целевой точки сервер применяет все доступные записи WAL. Линия времени отделяет историю восстановленного сервера от истории старого: сегменты разных линий не путаются, даже если оба сервера пишут в один архив.', '[["Сервер перешёл на новую линию времени 2",true,"В опыте журнал: «выбранный ID новой линии времени: 2», имена новых сегментов начались с 00000002."],["В pg_wal появился файл 00000002.history",true,"Файл истории описывает, в какой точке линия 2 ответвилась от линии 1. При включённой архивации он тоже уходит в архив."],["Новые сегменты пишутся с префиксом 00000001",false,"Тогда их имена совпали бы с сегментами старого сервера в общем архиве, а новая линия времени этого не допускает."],["recovery.signal остаётся до ручного удаления",false,"После окончания восстановления сервер удаляет recovery.signal: в опыте файла в каталоге не осталось."]]')
    ) AS fixes(old_question, new_question, explanation, variants)
    LOOP
        SELECT count(*) INTO matches FROM questions q JOIN categories c ON c.id=q.category_id
        WHERE left(c.name,3)='14.' AND q.question_text IN (fix.old_question,fix.new_question);
        IF matches <> 1 THEN RAISE EXCEPTION 'Не найден единственный вопрос набора 140'; END IF;
        SELECT q.* INTO STRICT candidate FROM questions q JOIN categories c ON c.id=q.category_id
        WHERE left(c.name,3)='14.' AND q.question_text IN (fix.old_question,fix.new_question);
        SELECT string_agg(o.key,'' ORDER BY o.key) INTO expected_answer
        FROM jsonb_each_text(candidate.options) o
        JOIN jsonb_array_elements(fix.variants::jsonb) v ON o.value=v->>0
        WHERE (v->>1)::boolean;
        IF candidate.explanation IS DISTINCT FROM fix.explanation
            OR candidate.correct_answer IS DISTINCT FROM expected_answer
            OR (SELECT count(*) FROM jsonb_each(candidate.options)) <> jsonb_array_length(fix.variants::jsonb)
            OR (SELECT count(*) FROM jsonb_each(candidate.option_notes)) <> jsonb_array_length(fix.variants::jsonb)
            OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(fix.variants::jsonb) v
                WHERE (SELECT count(*) FROM jsonb_each_text(candidate.options) o
                    WHERE o.value=v->>0 AND candidate.option_notes->>o.key=v->>2) <> 1
            ) THEN RAISE EXCEPTION 'Неожиданные варианты, ключи или пояснения'; END IF;
        IF candidate.question_text=fix.old_question THEN
            INSERT INTO question_archive(question_id,question_text,options,correct_answer,explanation,option_notes,reason)
            SELECT candidate.id,candidate.question_text,candidate.options,candidate.correct_answer,
                candidate.explanation,candidate.option_notes,archive_reason
            WHERE NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id=candidate.id AND a.reason=archive_reason);
            UPDATE questions SET question_text=fix.new_question WHERE id=candidate.id;
        END IF;
        SELECT count(*) INTO matches FROM question_archive a WHERE a.question_id=candidate.id AND a.reason=archive_reason;
        IF matches <> 1 THEN RAISE EXCEPTION 'Нет единственной архивной версии'; END IF;
        SELECT * INTO STRICT archived FROM question_archive a WHERE a.question_id=candidate.id AND a.reason=archive_reason;
        IF archived.question_text IS DISTINCT FROM fix.old_question
            OR archived.options IS DISTINCT FROM candidate.options
            OR archived.correct_answer IS DISTINCT FROM candidate.correct_answer
            OR archived.explanation IS DISTINCT FROM candidate.explanation
            OR archived.option_notes IS DISTINCT FROM candidate.option_notes
            THEN RAISE EXCEPTION 'Архив не совпадает с исходным содержимым'; END IF;
    END LOOP;
END
$rewrite$;
COMMIT;
