-- Исправление общих пояснений двух вопросов темы 03 (Конфигурирование): прежние тексты не объясняли ответ.
-- Источник: scripts/questions/013_topics_01_04.js
-- Повторный запуск безопасен: вопрос ищется по тексту и по прежнему или новому пояснению.
-- https://www.postgresql.org/docs/16/runtime-config-file-locations.html
-- https://www.postgresql.org/docs/16/config-setting.html

BEGIN;
SET LOCAL standard_conforming_strings = on;

DO $fix$
DECLARE fix record; matches integer;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('После ошибки в файле конфигурации сервер не запускается. Где искать причину?', 'В практике курса ошибка в max_connections (буква O вместо нуля) не даёт серверу стартовать.', 'Пока сервер не запущен, к нему нельзя подключиться, поэтому pg_settings и \dconfig недоступны. Сервер записывает в журнал имя файла, номер строки и параметр, из-за которых не смог стартовать.'),
        ('Как в пакете Ubuntu сервер находит postgresql.conf, если файл лежит вне каталога данных?', 'PID основного процесса записан в первой строке файла postmaster.pid в PGDATA.', 'Пакетные скрипты Ubuntu (pg_ctlcluster) запускают сервер с параметром -c config_file=/etc/postgresql/16/main/postgresql.conf. Путь виден в выводе ps у основного процесса и в SHOW config_file.')
    ) AS fixes(question_text, old_explanation, explanation)
    LOOP
        SELECT count(*) INTO matches FROM questions
        WHERE question_text = fix.question_text AND explanation IN (fix.old_explanation, fix.explanation);
        IF matches <> 1 THEN
            RAISE EXCEPTION 'Не найден единственный вопрос с ожидаемым пояснением';
        END IF;
        UPDATE questions SET explanation = fix.explanation
        WHERE question_text = fix.question_text AND explanation = fix.old_explanation;
    END LOOP;
END
$fix$;

COMMIT;
