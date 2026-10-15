-- Пять практических вопросов о конфигурировании PostgreSQL 16 и уточнения пояснений о pg_file_settings.
-- Источник: scripts/questions/031_configuration_practice.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL
-- https://www.postgresql.org/docs/16/runtime-config-file-locations.html
-- https://manpages.debian.org/bookworm/postgresql-client-common/pg_wrapper.1.en.html
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/sql-set.html
-- https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADMIN-GENFILE
-- https://www.postgresql.org/docs/16/config-setting.html#CONFIG-SETTING-CONFIGURATION-FILE
-- https://github.com/postgres/postgres/blob/REL_16_STABLE/src/bin/psql/describe.c
-- https://www.postgresql.org/docs/16/view-pg-file-settings.html
-- https://www.postgresql.org/docs/16/view-pg-settings.html

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

DO $notes$
DECLARE fix record; matches integer;
BEGIN
    FOR fix IN SELECT * FROM (VALUES
        ('03.', 'Какое представление показывает строки файлов конфигурации со столбцами applied и error?', '{"A":"pg_settings","B":"pg_file_settings","C":"pg_config","D":"pg_hba_file_rules"}', 'B', 'pg_settings показывает действующие значения, а pg_file_settings — содержимое файлов конфигурации.', '{"A":"Показывает действующие значения параметров.","B":"Показывает строки текущих файлов конфигурации, можно ли их применить и найденные ошибки.","C":"Показывает параметры сборки сервера.","D":"Показывает строки файла pg_hba.conf."}', 'pg_file_settings анализирует текущее содержимое конфигурационных файлов, а не состояние после последнего перечитывания. applied = true означает, что запись может быть успешно применена, но не подтверждает, что это значение уже действует в сеансе. Текущее значение проверяют через pg_settings или SHOW.', '{"A":"Показывает действующие значения параметров в текущем сеансе с учётом применённых переопределений.","B":"Анализирует текущее содержимое файлов: возможность применения записей и ошибки. Это не журнал уже применённых значений.","C":"Показывает параметры сборки сервера.","D":"Показывает строки файла pg_hba.conf."}'),
        ('03.', 'В каких случаях строка в pg_file_settings будет иметь applied = false?', '{"A":"Изменение параметра требует перезапуска сервера","B":"Тот же параметр задан в строке, которая будет прочитана позже","C":"Значение совпадает со значением по умолчанию","D":"В строке есть ошибка"}', 'ABD', 'Представление показывает файл и номер строки, что удобно для поиска ошибок.', '{"A":"Перечитывание конфигурации такое значение не применит.","B":"Применяется значение из последней считанной строки.","C":"Совпадение со значением по умолчанию не мешает применению.","D":"В столбце error будет её описание."}', 'pg_file_settings проверяет текущее содержимое файлов. applied = false возможно из-за ошибки, невозможности изменить параметр без перезапуска или перекрытия более поздней записью. При перекрытии error пуст. applied = true не доказывает, что настройка уже действует: текущее значение смотрят в pg_settings.', '{"A":"Если новое значение параметра нельзя применить без перезапуска, applied будет false, а error укажет причину.","B":"Более позднее определение перекрывает эту запись: applied будет false, но само перекрытие не считается ошибкой и error остаётся NULL.","C":"Само совпадение со значением по умолчанию не препятствует применению записи.","D":"Причину показывает error. Синтаксическая ошибка или неизвестное имя параметра могут сделать applied равным false и у других записей."}')
    ) AS fixes(topic, question_text, options, correct_answer, old_explanation, old_notes, explanation, notes)
    LOOP
        SELECT count(*) INTO matches FROM questions q JOIN categories c ON c.id = q.category_id
        WHERE left(c.name, 3) = fix.topic AND q.question_text = fix.question_text;
        IF matches <> 1 OR NOT EXISTS (
            SELECT 1 FROM questions q JOIN categories c ON c.id = q.category_id
            WHERE left(c.name, 3) = fix.topic AND q.question_text = fix.question_text
              AND q.options = fix.options::jsonb AND q.correct_answer = fix.correct_answer
              AND ((q.explanation = fix.old_explanation AND q.option_notes = fix.old_notes::jsonb)
                OR (q.explanation = fix.explanation AND q.option_notes = fix.notes::jsonb))
        ) THEN
            RAISE EXCEPTION 'Не найден единственный вопрос с ожидаемыми ключами и пояснениями';
        END IF;
        UPDATE questions q SET explanation = fix.explanation, option_notes = fix.notes::jsonb
        FROM categories c WHERE c.id = q.category_id AND left(c.name, 3) = fix.topic
          AND q.question_text = fix.question_text
          AND (q.explanation IS DISTINCT FROM fix.explanation OR q.option_notes IS DISTINCT FROM fix.notes::jsonb);
    END LOOP;
END
$notes$;

CREATE TEMP TABLE question_seed (
    category_id integer NOT NULL,
    question_text text NOT NULL UNIQUE,
    options jsonb NOT NULL,
    correct_answer text NOT NULL,
    explanation text NOT NULL,
    option_notes jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO question_seed
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'На сервере работают несколько независимых кластеров PostgreSQL. В текущем сеансе SHOW data_directory возвращает /var/lib/postgresql/16/main. Для какого кластера вызов SELECT pg_reload_conf(); из этого сеанса инициирует перечитывание конфигурации?', '{"A":"Только для текущей базы данных внутри кластера","B":"Только для кластера с каталогом данных /var/lib/postgresql/16/main","C":"Для всех кластеров версии 16, но не других версий","D":"Для всех кластеров PostgreSQL на этой машине"}'::jsonb, 'B', 'pg_reload_conf посылает SIGHUP основному процессу текущего сервера. Результат true подтверждает успешную отправку сигнала, но не гарантирует применение всех настроек: возможны ошибки конфигурации и параметры, требующие перезапуска.', '{"A":"Перечитывание конфигурации относится к экземпляру сервера, а не к одной базе данных.","B":"Сигнал получает основной процесс того сервера, к которому подключён сеанс; он передаёт сигнал своим дочерним процессам.","C":"Совпадение версии не объединяет управление конфигурацией разных кластеров.","D":"Независимые экземпляры сервера не получают сигнал от этого вызова автоматически."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'В Debian/Ubuntu psql запускается через штатный pg_wrapper. Локальные кластеры принимают TCP-подключения на 127.0.0.1, доступ роли postgres к базе postgres разрешён; переменные окружения не переопределяют подключение. Какие две команды выберут кластер 16/trainrepl при таком выводе pg_lsclusters?
```
Ver Cluster   Port Status
16  main      5432 online
16  trainrepl 5434 online,recovery
17  main      5433 online
```', '{"A":"`psql --cluster 16/main -U postgres -d postgres`","B":"`psql -h 127.0.0.1 -p 5433 -U postgres -d postgres`","C":"`psql -h 127.0.0.1 -p 5434 -U postgres -d postgres`","D":"`psql --cluster 16/trainrepl -U postgres -d postgres`"}'::jsonb, 'CD', 'В Debian/Ubuntu --cluster обрабатывается pg_wrapper. При подключении по адресу и порту целевой сервер определяется этим адресом и портом; версия клиентской программы psql сама по себе не выбирает кластер.', '{"A":"Имя main выбирает другой кластер той же версии.","B":"По таблице порт 5433 принадлежит кластеру 17/main.","C":"Указаны адрес и порт нужного работающего экземпляра сервера.","D":"Опция обёртки --cluster выбирает кластер по версии и имени."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Сравнивают два независимых запуска команд. Перед каждым запуском вне транзакции установлено work_mem = 8MB. После приведённых команд в первом запуске выполняют COMMIT, во втором — ROLLBACK; других изменений настройки нет. Какие значения покажет SHOW work_mem после завершения транзакции в первом и втором случаях?
```
BEGIN;
SET work_mem = ''32MB'';
SET LOCAL work_mem = ''64MB'';
```', '{"A":"После COMMIT — 64MB, после ROLLBACK — 8MB","B":"После COMMIT — 8MB, после ROLLBACK — 8MB","C":"После COMMIT — 32MB, после ROLLBACK — 32MB","D":"После COMMIT — 32MB, после ROLLBACK — 8MB"}'::jsonb, 'D', 'Внутри транзакции после SET LOCAL действует 64MB. После COMMIT локальное переопределение исчезает и действует 32MB из SET; после ROLLBACK отменяются обе установки и возвращается исходное значение 8MB.', '{"A":"Фиксация не превращает SET LOCAL в постоянную настройку сеанса.","B":"При COMMIT сохраняется выполненный в транзакции обычный SET со значением 32MB.","C":"ROLLBACK отменяет и обычный SET, выполненный внутри отменяемой транзакции.","D":"COMMIT сохраняет сеансовый SET, а ROLLBACK отменяет его; SET LOCAL прекращает действие при обоих исходах."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '03.'), 'Клиент psql запущен на ноутбуке и подключён к удалённому серверу PostgreSQL. Где функция SELECT pg_read_file(''postgresql.auto.conf''); ищет файл? Файл существует, необходимые права на чтение есть.', '{"A":"На сервере, рядом с postgresql.conf независимо от data_directory","B":"На ноутбуке, в рабочем каталоге процесса psql","C":"На сервере, в домашнем каталоге пользователя операционной системы postgres","D":"На сервере PostgreSQL, в каталоге данных текущего кластера"}'::jsonb, 'D', 'pg_read_file читает текстовый файл на машине сервера. Имя postgresql.auto.conf без абсолютного пути относится к каталогу данных подключённого кластера, даже если postgresql.conf вынесен в /etc/postgresql.', '{"A":"Главный файл конфигурации может лежать вне каталога данных; его расположение не задаёт базу этого относительного пути.","B":"SQL-функцию выполняет сервер; она не читает файловую систему клиента.","C":"Домашний каталог пользователя ОС не является базой относительного пути этой функции.","D":"Относительный путь для этой серверной функции отсчитывается от data_directory."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '02.'), 'Что показывает команда psql 16 \dconfig без шаблона имени параметра, в отличие от \dconfig *?', '{"A":"Только строки postgresql.conf, включая ошибки и повторные определения","B":"Только параметры, ожидающие перезапуска сервера","C":"Параметры, установленные в значения, отличные от встроенных значений по умолчанию","D":"Все параметры сервера без фильтрации"}'::jsonb, 'C', 'Без шаблона dconfig показывает параметры с нестандартными значениями. Шаблон * снимает этот отбор; шаблон *mem* выбирает параметры по имени. Команда не изменяет настройки сервера.', '{"A":"Команда показывает текущие значения параметров через pg_settings; строки файлов диагностируют через pg_file_settings.","B":"Отбор без шаблона не ограничен признаком pending_restart.","C":"Без шаблона команда отбирает параметры с источником не default и значением, отличным от boot_val.","D":"Для полного списка используется шаблон *, а не вызов без шаблона."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 5 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
