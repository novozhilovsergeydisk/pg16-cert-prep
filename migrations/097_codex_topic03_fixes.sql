-- Тема 03: правки по отчёту Codex (19 исправлений в 11 вопросах), ключи не меняются.
-- Источник: scripts/questions/097_codex_topic03_fixes.js
-- Повторный запуск безопасен: вопрос и вариант ищутся по тексту, прежнее или уже новое значение допустимо,
-- иначе пакет отменяется. Ключи ответов, число и порядок вариантов не меняются.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $fix$
DECLARE fix record; matches integer; qid integer; k text;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('option', 'Как задать work_mem = 32MB для сеанса прямо при запуске psql?', 'Переменная PGOPTIONS=''-c work_mem=32MB''', 'PGOPTIONS=''-c work_mem=32MB'' psql', NULL, NULL),
        ('option', 'Как задать work_mem = 32MB для сеанса прямо при запуске psql?', 'Переменная окружения PGWORKMEM=32MB', NULL, 'Такой переменной нет.', 'libpq не использует переменную PGWORKMEM.'),
        ('option', 'Что верно для значений user, superuser и internal столбца context в pg_settings?', 'superuser — меняет в сеансе суперпользователь или роль с правом SET', 'superuser — нужен суперпользователь или право SET на этот параметр', NULL, NULL),
        ('option', 'Что верно для значений user, superuser и internal столбца context в pg_settings?', 'internal — параметр нельзя изменить (block_size)', 'internal — параметр нельзя задать ни SET, ни в файле', NULL, NULL),
        ('option', 'Что верно для значений user, superuser и internal столбца context в pg_settings?', 'internal — параметр меняется командой ALTER SYSTEM', NULL, 'Параметры internal нельзя изменить никак: ALTER SYSTEM ответит, что параметр нельзя изменить.', 'Параметры internal нельзя задать командами настройки или в файле конфигурации; ALTER SYSTEM их отклонит.'),
        ('option', 'Что делает команда ALTER SYSTEM RESET ALL?', 'Удаляет из postgresql.auto.conf все заданные параметры', NULL, 'Удаляет из postgresql.auto.conf все параметры, заданные через ALTER SYSTEM; изменения вступят в силу после перечитывания конфигурации или перезапуска. ALTER SYSTEM меняет только файл, а действующие значения остаются прежними до перечитывания. Параметрам с context = postmaster одного перечитывания мало, нужен перезапуск.', 'Удаляет из postgresql.auto.conf все назначения параметров, кто бы их туда ни записал; изменения вступят в силу после перечитывания конфигурации или перезапуска. ALTER SYSTEM меняет только файл, а действующие значения остаются прежними до перечитывания. Параметрам с context = postmaster одного перечитывания мало, нужен перезапуск.'),
        ('explanation', 'Что делает команда ALTER SYSTEM RESET ALL?', NULL, NULL, 'После перечитывания снова начнут действовать значения из postgresql.conf и подключённых к нему файлов, которые раньше перекрывал postgresql.auto.conf.', 'После перечитывания конфигурации (или перезапуска, если его требует контекст параметра) действующие значения снова определяются остальными источниками: postgresql.conf, подключёнными к нему файлами и установками с более высоким приоритетом.'),
        ('option', 'Приложение работает через пул соединений в режиме пула транзакций и внутри своей транзакции меняет параметр. Как это сделать, чтобы изменение не повлияло на транзакции других клиентов?', 'Командой ALTER SYSTEM SET и перечитыванием', NULL, 'Это изменит значение для всего сервера.', 'ALTER SYSTEM нельзя выполнить внутри транзакционного блока; вне его он меняет общую конфигурацию сервера, а не настройку одной транзакции.'),
        ('option', 'Приложение работает через пул соединений в режиме пула транзакций и внутри своей транзакции меняет параметр. Как это сделать, чтобы изменение не повлияло на транзакции других клиентов?', 'Командой SET, значение действует до конца сеанса', NULL, 'Через пул один сеанс сервера обслуживает и чужие транзакции, и они увидят изменённое значение.', 'После COMMIT обычный SET остаётся в сеансе сервера, который через пул обслуживает и чужие транзакции; при ROLLBACK изменение отменяется.'),
        ('option', 'Приложение работает через пул соединений в режиме пула транзакций и внутри своей транзакции меняет параметр. Как это сделать, чтобы изменение не повлияло на транзакции других клиентов?', 'Командой SET LOCAL или set_config(…, true)', 'Командой SET LOCAL в этой транзакции', NULL, NULL),
        ('option', 'В транзакции выполнили SET work_mem = ''64MB'', затем ROLLBACK. Какое будет значение?', 'Значение по умолчанию (boot_val)', NULL, 'Возвращается не значение по умолчанию, а действовавшее до транзакции.', 'Возвращается значение, действовавшее до транзакции. Оно может совпасть с boot_val, но откат не сбрасывает параметр к boot_val.'),
        ('option', 'В транзакции выполнили SET work_mem = ''64MB'', затем ROLLBACK. Какое будет значение?', 'Значение, действовавшее до транзакции', 'Прежнее, действовавшее до транзакции', NULL, NULL),
        ('explanation', 'Какой файл параметров сервера считывается последним?', NULL, NULL, 'Среди файлов конфигурации последним считывается postgresql.auto.conf и перекрывает значения postgresql.conf. Параметры командной строки сервера и установки для базы, роли и сеанса действуют поверх файлов.', 'Среди файлов параметров сервера последним считывается postgresql.auto.conf и перекрывает значения postgresql.conf. Параметры командной строки сервера и установки для базы, роли и сеанса действуют поверх файлов.'),
        ('option', 'Чем директива include_if_exists отличается от include?', 'Подключает все файлы из каталога', NULL, 'Это делает include_dir (только файлы с окончанием .conf).', 'Это делает include_dir: он читает файлы с окончанием .conf, кроме имён, начинающихся с точки.'),
        ('option', 'Чем директива include_if_exists отличается от include?', 'Отсутствие файла не считается ошибкой при запуске', 'Отсутствие файла не считается ошибкой', NULL, NULL),
        ('explanation', 'Запрос SELECT setting, unit FROM pg_settings WHERE name = ''work_mem''; вернул 4096 и kB. Чему равен work_mem?', NULL, NULL, 'Команда SHOW work_mem; сразу показывает значение с единицей: 4MB. У shared_buffers по умолчанию setting = 16384 и unit = 8kB, то есть 128 МБ.', 'Команда SHOW work_mem; сразу показывает значение с единицей: 4MB. Например, у shared_buffers при setting = 16384 и unit = 8kB это 128 МБ.'),
        ('option', 'Чем имя пользовательского параметра должно отличаться от стандартного?', 'Содержать точку, как в myapp.currency_code', 'Содержать точку между префиксом и именем', NULL, NULL),
        ('option', 'Почему ALTER SYSTEM SET work_mem TO ''16mb'' завершается ошибкой?', 'Единица MB пишется с учётом регистра: ''16MB''', 'Неверно указан регистр единицы измерения', NULL, NULL),
        ('option', 'На сервере работают несколько независимых кластеров PostgreSQL. В текущем сеансе SHOW data_directory возвращает /var/lib/postgresql/16/main. Для какого кластера вызов SELECT pg_reload_conf(); из этого сеанса инициирует перечитывание конфигурации?', 'Для кластера с каталогом /var/lib/postgresql/16/main', 'Для кластера, к которому подключён сеанс', NULL, NULL)
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
