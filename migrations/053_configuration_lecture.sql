-- Восемь вопросов раздела «03. Конфигурирование» по сверке с лекцией: config_file, единицы в pg_settings, значения context, параметры с перезапуском, sourcefile и sourceline, ALTER SYSTEM RESET ALL, current_setting с missing_ok, параметры при пуле соединений; пояснения к каждому варианту.
-- Источник: scripts/questions/053_configuration_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/runtime-config-file-locations.html
-- https://www.postgresql.org/docs/16/view-pg-settings.html
-- https://www.postgresql.org/docs/16/config-setting.html
-- https://www.postgresql.org/docs/16/sql-grant.html
-- https://www.postgresql.org/docs/16/runtime-config-resource.html#GUC-SHARED-BUFFERS
-- https://www.postgresql.org/docs/16/sql-altersystem.html
-- https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SET
-- https://www.postgresql.org/docs/16/runtime-config-custom.html
-- https://www.postgresql.org/docs/16/sql-set.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Как из SQL-сеанса узнать, где находится основной файл конфигурации postgresql.conf работающего сервера?', '{"A":"SHOW data_directory;","B":"SHOW config_file;","C":"SELECT pg_reload_conf();","D":"SHOW hba_file;"}'::jsonb, 'B', 'В пакетах Debian и Ubuntu ответ — /etc/postgresql/16/main/postgresql.conf; при сборке из исходников файл обычно лежит в каталоге данных. Файл postgresql.auto.conf всегда лежит в каталоге данных: SHOW data_directory;', '{"A":"Это каталог данных; postgresql.conf может лежать и вне его, как в пакетах Debian и Ubuntu.","B":"Параметр config_file хранит полный путь к основному файлу конфигурации.","C":"Функция перечитывает конфигурацию, а путь к файлу не показывает.","D":"Это путь к файлу pg_hba.conf с правилами аутентификации."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Запрос SELECT setting, unit FROM pg_settings WHERE name = ''work_mem''; вернул 4096 и kB. Чему равен work_mem?', '{"A":"4096 МБ","B":"4 МБ: значение указано в единицах из столбца unit, то есть 4096 КБ","C":"4096 байт","D":"4096 страниц по 8 КБ"}'::jsonb, 'B', 'Команда SHOW work_mem; сразу показывает значение с единицей: 4MB. У shared_buffers по умолчанию setting = 16384 и unit = 8kB, то есть 128 МБ.', '{"A":"unit = kB означает килобайты; 4096 МБ — это 4 ГБ.","B":"В столбце setting число, а единицу измерения задаёт столбец unit.","C":"Единица указана в столбце unit — это килобайты, а не байты.","D":"В страницах по 8 КБ измеряются другие параметры, например shared_buffers: у него unit = 8kB."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Что верно для значений user, superuser и internal столбца context в pg_settings?', '{"A":"user — любой пользователь может изменить параметр в своём сеансе, например work_mem","B":"user — для применения нового значения нужен перезапуск сервера","C":"superuser — в своём сеансе параметр может изменить суперпользователь или роль, которой выдано право SET на этот параметр","D":"internal — параметр изменить нельзя, например block_size","E":"internal — параметр меняется только командой ALTER SYSTEM"}'::jsonb, 'ACD', 'Кроме того, бывают postmaster (нужен перезапуск) и sighup (достаточно перечитать конфигурацию), а также backend и superuser-backend: такие параметры задают при подключении, а в уже начатом сеансе изменить нельзя. Проверка: SELECT name, context FROM pg_settings WHERE name IN (''block_size'', ''work_mem'', ''log_statement'');', '{"A":"Для этого достаточно команды SET.","B":"Перезапуск нужен при context = postmaster.","C":"Пример — log_statement: обычная роль получит ошибку «нет прав для изменения параметра».","D":"Параметр internal нельзя изменить ни файлом конфигурации, ни командой SET; например, block_size задаётся при сборке сервера.","E":"Параметры internal нельзя изменить никак: ALTER SYSTEM ответит, что параметр нельзя изменить."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Допишите запрос, чтобы получить список параметров, изменение которых вступает в силу только после перезапуска сервера:
```
SELECT name FROM pg_settings WHERE context = ''___'';
```', '{"A":"`postmaster`","B":"`internal`","C":"`sighup`","D":"`restart`"}'::jsonb, 'A', 'Если такой параметр изменён в файле, после перечитывания конфигурации в pg_settings у него будет pending_restart = true, а в pg_file_settings — applied = false.', '{"A":"Такие параметры читает только postmaster при запуске, например shared_buffers и max_connections.","B":"Их нельзя изменить вовсе, даже перезапуском.","C":"Для них достаточно перечитать конфигурацию без перезапуска.","D":"Такого значения context нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Какие столбцы pg_settings показывают, из какого файла и с какой строки взято текущее значение параметра?', '{"A":"context и pending_restart","B":"boot_val и reset_val","C":"sourcefile и sourceline","D":"setting и unit"}'::jsonb, 'C', 'Если параметр задан в нескольких файлах, столбцы показывают действующее значение, то есть прочитанное последним.', '{"A":"Это способ изменения параметра и признак того, что новое значение ждёт перезапуска.","B":"Это значение по умолчанию и значение, к которому вернёт команда RESET.","C":"Если текущее значение взято из файла конфигурации, они показывают файл и номер строки. Для других источников они пусты, как и для пользователя без прав суперпользователя или членства в роли pg_read_all_settings.","D":"Это текущее значение и единица измерения."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Что делает команда ALTER SYSTEM RESET ALL?', '{"A":"Сразу возвращает всем параметрам значения по умолчанию на работающем сервере","B":"Сбрасывает все параметры текущего сеанса к значениям из reset_val","C":"Удаляет все параметры из postgresql.conf","D":"Удаляет из postgresql.auto.conf все параметры, заданные через ALTER SYSTEM; изменения вступят в силу после перечитывания конфигурации или перезапуска"}'::jsonb, 'D', 'После перечитывания снова начнут действовать значения из postgresql.conf и подключённых к нему файлов, которые раньше перекрывал postgresql.auto.conf.', '{"A":"Действующие значения изменятся только после перечитывания конфигурации.","B":"Это делает команда RESET ALL без ALTER SYSTEM.","C":"ALTER SYSTEM работает только с файлом postgresql.auto.conf.","D":"ALTER SYSTEM меняет только файл, а действующие значения остаются прежними до перечитывания. Параметрам с context = postmaster одного перечитывания мало, нужен перезапуск."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Пользовательский параметр myapp.currency в этом сеансе ещё ни разу не задавался. Что вернёт SELECT current_setting(''myapp.currency'', true);?', '{"A":"Значение true","B":"NULL","C":"Пустую строку","D":"Ошибку «нераспознанный параметр конфигурации»"}'::jsonb, 'B', 'Пользовательские параметры удобны как переменные сеанса. Их можно задать и в файле конфигурации, например через ALTER SYSTEM SET myapp.currency = ''RUB''; после перечитывания значение увидят все новые сеансы.', '{"A":"Второй аргумент — признак «отсутствие допустимо», а не значение по умолчанию.","B":"Второй аргумент true разрешает отсутствие параметра: вместо ошибки возвращается NULL.","C":"Пустую строку вернёт параметр, который уже создавался в сеансе, например командой SET LOCAL в завершившейся транзакции; для ни разу не заданного параметра будет NULL.","D":"Так будет без второго аргумента или с false."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Приложение работает через пул соединений в режиме пула транзакций и внутри своей транзакции меняет параметр. Как это сделать, чтобы изменение не повлияло на транзакции других клиентов?', '{"A":"Командой ALTER ROLE ... SET","B":"Командой ALTER SYSTEM SET и вызовом pg_reload_conf()","C":"Командой SET LOCAL или функцией set_config с третьим аргументом true: значение действует только до конца текущей транзакции","D":"Командой SET: значение действует до конца сеанса"}'::jsonb, 'C', 'В режиме пула транзакций следующая транзакция того же клиента может попасть в другой сеанс сервера, а в его сеанс — транзакция другого клиента.', '{"A":"Это значение по умолчанию для новых сеансов роли, а не для одной транзакции.","B":"Это изменит значение для всего сервера.","C":"После COMMIT или ROLLBACK параметр вернётся к прежнему значению.","D":"Через пул один сеанс сервера обслуживает и чужие транзакции, и они увидят изменённое значение."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 8 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
