-- Тема 13: правки по отчёту Codex (16 исправлений в 11 вопросах), ключи не меняются.
-- Источник: scripts/questions/099_codex_topic13_fixes.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('question', 'Какие права должны быть у файла ~/.pgpass, чтобы PostgreSQL его использовал?', NULL, NULL, NULL, 'Какие права должны быть у файла ~/.pgpass, чтобы libpq в Unix его использовал?'),
        ('option', 'Что верно для владельца объекта?', 'Владельцем может быть суперпользователь кластера', 'Владение объектом даёт роли атрибут SUPERUSER', 'Владельцем может быть любая роль, а не только суперпользователь.', 'Владение даёт права на конкретный объект и не меняет атрибуты роли; владельцем может быть любая роль.'),
        ('option', 'Когда сервер в Linux начинает применять изменения, внесённые в pg_hba.conf?', 'После полной остановки и запуска сервера', 'Не раньше полной остановки и запуска сервера', 'Перезапуск не нужен, достаточно перечитать конфигурацию.', 'Перезапуск тоже прочитает файл, но он не нужен: работающему серверу достаточно перечитать конфигурацию.'),
        ('option', 'Когда сервер в Linux начинает применять изменения, внесённые в pg_hba.conf?', 'После перечитывания, например pg_reload_conf()', 'После перечитывания конфигурации', NULL, NULL),
        ('option', 'Подходящая строка в pg_hba.conf найдена, но аутентификация не прошла. Что дальше?', 'Доступ отклоняется, остальные строки не читаются', 'Доступ отклоняется без проверки других строк', NULL, NULL),
        ('explanation', 'Какие права должны быть у файла ~/.pgpass, чтобы libpq в Unix его использовал?', NULL, NULL, 'При более широких правах файл игнорируется.', 'Если у файла есть права для группы или остальных, libpq его игнорирует.'),
        ('option', 'Какой парольный метод аутентификации рекомендуется использовать?', 'Метод md5 из pg_hba.conf', NULL, 'Менее надёжен, чем scram-sha-256.', 'Протокол MD5 менее надёжен; если пароль роли хранится в формате SCRAM, при методе md5 сервер сам выберет SCRAM.'),
        ('option', 'Какой парольный метод аутентификации рекомендуется использовать?', 'Метод password из pg_hba.conf', NULL, 'Передаёт пароль открытым текстом.', 'Передаёт пароль открытым текстом, защитить его может лишь TLS.'),
        ('option', 'Какие методы аутентификации запрашивают пароль?', 'Метод md5 из pg_hba.conf', NULL, 'Тоже запрашивает пароль, но менее надёжен.', 'Тоже парольный метод; если пароль хранится в формате SCRAM, сервер фактически проведёт SCRAM-аутентификацию.'),
        ('option', 'Какие методы аутентификации запрашивают пароль?', 'Метод trust из pg_hba.conf', NULL, 'Пускает без проверок.', 'Не запрашивает подтверждения личности.'),
        ('option', 'Как работает метод аутентификации peer?', 'Разрешает подключение без каких-либо проверок', NULL, 'Так работает trust.', 'Так работает trust: он не подтверждает личность, но правила pg_hba.conf, атрибут LOGIN и право CONNECT действуют.'),
        ('option', 'Как работает метод аутентификации peer?', 'Спрашивает имя пользователя у ОС и сверяет с ролью', 'Сверяет с ролью имя пользователя ОС', NULL, NULL),
        ('option', 'Что разрешает привилегия USAGE на схему?', 'Обращаться к объектам этой схемы', NULL, 'Без неё объекты схемы не найти по имени.', 'Без неё имена объектов схемы не разрешаются; права на операции с объектами проверяются отдельно.'),
        ('option', 'Почему недостаточно один раз отозвать у public привилегию EXECUTE на все подпрограммы?', 'Новые подпрограммы снова получают EXECUTE для public', NULL, 'Для каждой новой подпрограммы public снова получает EXECUTE автоматически; остановить это можно механизмом привилегий по умолчанию.', 'Для каждой новой подпрограммы public снова получает EXECUTE автоматически, если привилегии по умолчанию не меняли; остановить это можно командой ALTER DEFAULT PRIVILEGES.'),
        ('option', 'Роль bob с атрибутом NOINHERIT включили в роль dba командой GRANT dba TO bob. Как bob может воспользоваться привилегиями dba?', 'После явного переключения командой SET ROLE dba', 'После переключения на роль dba', 'Автоматически привилегии dba не применяются, а переключение разрешено.', 'При создании этого членства получаются INHERIT FALSE и SET TRUE: права dba доступны после SET ROLE dba.'),
        ('option', 'Что такое public в контексте ролей?', 'Псевдороль, которую неявно имеют все роли', 'Псевдороль, включающая все роли', NULL, NULL)
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
