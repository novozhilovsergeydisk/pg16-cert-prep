-- Одиннадцать вопросов раздела «08. Базы данных и схемы» по сверке с лекцией: CONNECTION LIMIT и datallowconn, переименование и удаление базы, ALTER TABLE ... SET SCHEMA, DROP SCHEMA и CASCADE, временное представление, временная таблица перекрывает постоянную, search_path сеанса и базы; пояснения к каждому варианту.
-- Источник: scripts/questions/129_databases_schemas_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/sql-alterdatabase.html
-- https://www.postgresql.org/docs/16/catalog-pg-database.html
-- https://www.postgresql.org/docs/16/manage-ag-templatedbs.html
-- https://www.postgresql.org/docs/16/sql-dropdatabase.html
-- https://www.postgresql.org/docs/16/sql-altertable.html
-- https://www.postgresql.org/docs/16/sql-dropschema.html
-- https://www.postgresql.org/docs/16/sql-createview.html
-- https://www.postgresql.org/docs/16/ddl-schemas.html
-- https://www.postgresql.org/docs/16/runtime-config-client.html
-- https://www.postgresql.org/docs/16/sql-set.html
-- https://www.postgresql.org/docs/16/sql-alterrole.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Для базы appdb выполнили ALTER DATABASE appdb CONNECTION LIMIT 1. К appdb уже подключён один обычный пользователь. Что верно для новых подключений к appdb?', '{"A":"Новое подключение будет ждать свободного места","B":"Сервер разорвёт сеанс, открытый раньше","C":"Суперпользователь подключится, несмотря на лимит","D":"Второй обычный пользователь получит ошибку"}'::jsonb, 'CD', 'Лимит хранится в pg_database.datconnlimit, значение -1 означает «без ограничения». Он проверяется при подключении и не распространяется на суперпользователей.', '{"A":"Очереди подключений нет: при достигнутом лимите сервер сразу отказывает.","B":"Открытые сеансы лимит не затрагивает, он проверяется при новом подключении.","C":"Ограничение CONNECTION LIMIT на суперпользователей не действует.","D":"Лимит достигнут, сервер отвечает «слишком много подключений к БД»."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Запрос к pg_database показывает у template0 datallowconn = false. Что это значит для администратора?', '{"A":"Подключиться к ней можно, но создать из неё базу нельзя","B":"Подключиться к ней может суперпользователь, а другие нет","C":"Сеансы в ней открываются в режиме чтения, без записи","D":"Подключиться к ней нельзя, но создать из неё базу можно"}'::jsonb, 'D', 'datallowconn = false запрещает любые подключения к базе. Так template0 защищена от изменений и остаётся чистым шаблоном. Меняют флаг командой ALTER DATABASE ... ALLOW_CONNECTIONS.', '{"A":"Использование базы как шаблона определяет datistemplate, у template0 он true.","B":"Запрет действует на всех, включая суперпользователя.","C":"Режима чтения тут нет: подключиться к базе нельзя вовсе.","D":"Для клонирования шаблона подключение к нему не нужно: CREATE DATABASE ... TEMPLATE template0 работает."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Вы подключены к appdb, других сеансов в ней нет. Вы выполняете ALTER DATABASE appdb RENAME TO app_old. Что произойдёт?', '{"A":"База переименуется, сеанс продолжит работу","B":"База переименуется после конца сеанса","C":"Сервер завершит сеанс и переименует базу","D":"Ошибка: текущую базу переименовать нельзя"}'::jsonb, 'D', 'Переименовать или удалить можно базу, к которой никто не подключён, включая вас. Поэтому такие команды выполняют из другой базы, обычно postgres.', '{"A":"Сервер не переименовывает базу, к которой подключён сам выполняющий команду сеанс.","B":"Отложенного переименования нет: команда сразу завершается ошибкой.","C":"Команда не разрывает собственный сеанс, а отказывает.","D":"Нужно подключиться к другой базе, например postgres, и повторить команду."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Вы суперпользователь и подключены к базе postgres. В базе appdb открыт один сеанс приложения, подготовленных транзакций и слотов репликации нет. Что верно?', '{"A":"DROP DATABASE appdb WITH (FORCE) удалит базу","B":"ALTER DATABASE appdb RENAME TO a выполнится","C":"DROP DATABASE appdb завершится ошибкой","D":"DROP DATABASE appdb дождётся конца сеанса"}'::jsonb, 'AC', 'Обычный DROP DATABASE отказывает, пока в базе есть сеансы. WITH (FORCE) завершает их, но и он не сработает при подготовленных транзакциях или активных слотах логической репликации.', '{"A":"FORCE сначала завершает сеансы в базе, затем удаляет её.","B":"Переименование тоже требует, чтобы к базе никто не был подключён.","C":"Сервер отвечает, что база занята другими пользователями.","D":"Команда не ждёт, а сразу завершается ошибкой."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Таблица public.orders занимает 50 ГБ, у неё первичный ключ и столбец identity. Что сделает ALTER TABLE orders SET SCHEMA app?', '{"A":"Перенесёт таблицу, а индекс оставит в public","B":"Сменит схему в каталоге, данные останутся на месте","C":"Скопирует таблицу в app, исходную оставит в public","D":"Перепишет файлы таблицы в каталог схемы app"}'::jsonb, 'B', 'SET SCHEMA меняет записи в системном каталоге, поэтому выполняется быстро при любом размере таблицы. Ей нужна блокировка ACCESS EXCLUSIVE: если таблицу долго читают, команда будет ждать.', '{"A":"Индексы и принадлежащие таблице последовательности переходят в новую схему вместе с ней.","B":"Файлы не переписываются. Первичный ключ и последовательность identity переходят в app вместе с таблицей.","C":"Это перемещение, а не копирование: в public таблицы не останется.","D":"У схемы нет своего каталога на диске, данные не копируются."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'В схеме app есть таблицы, которые больше не нужны. Допишите команду, чтобы удалить схему вместе с ними:
```
DROP SCHEMA app ___;
```', '{"A":"`RESTRICT`","B":"`CASCADE`","C":"`PURGE`","D":"`FORCE`"}'::jsonb, 'B', 'Перед CASCADE стоит посмотреть, что удалится: сервер перечисляет зависимые объекты в ошибке DROP SCHEMA без CASCADE.', '{"A":"Это поведение по умолчанию: если в схеме есть объекты, команда завершится ошибкой.","B":"Удаляет схему, её объекты и всё, что от них зависит, в том числе в других схемах, например представления.","C":"Такого слова в PostgreSQL нет.","D":"У DROP SCHEMA нет такого слова, FORCE есть у DROP DATABASE."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'В схеме app есть таблица t. Что сделает команда DROP SCHEMA app без других слов?', '{"A":"Удалит схему, когда в t не останется строк","B":"Завершится ошибкой: от схемы зависит таблица t","C":"Удалит схему app вместе с таблицей t","D":"Удалит схему, а таблицу t перенесёт в public"}'::jsonb, 'B', 'Непустую схему удаляют командой DROP SCHEMA ... CASCADE либо сначала удаляют или переносят её объекты.', '{"A":"Зависимость определяется наличием объекта, а не строк в нём.","B":"По умолчанию действует RESTRICT, сервер подсказывает использовать CASCADE.","C":"Так работает DROP SCHEMA app CASCADE.","D":"При удалении схемы объекты никуда не переносятся."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'В сеансе есть временная таблица t. Выполнили CREATE VIEW v AS SELECT * FROM t без слова TEMP. Что получится?', '{"A":"Временное представление, сервер выдаст замечание","B":"Постоянное представление, видное другим сеансам","C":"Постоянное представление, пустое в других сеансах","D":"Ошибка: нужно явно написать CREATE TEMP VIEW"}'::jsonb, 'A', 'Сервер выдаёт замечание «представление "v" будет создано как временное». Если представление нужно всем, его строят над постоянными таблицами.', '{"A":"Представление над временным объектом само становится временным: оно в pg_temp и исчезнет с концом сеанса.","B":"Постоянное представление не может зависеть от временной таблицы.","C":"Сервер не создаёт постоянное представление над временной таблицей.","D":"Ошибки нет, сервер сам делает представление временным."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'В схеме app есть таблица t с данными, search_path = app, public. В сеансе выполнили CREATE TEMP TABLE t (id int). Что верно в этом сеансе?', '{"A":"app.t доступна по полному имени, как и раньше","B":"SELECT * FROM t прочитает таблицу из схемы app","C":"SELECT * FROM t прочитает временную таблицу","D":"CREATE TEMP TABLE t завершится ошибкой: имя занято"}'::jsonb, 'AC', 'current_schemas(true) в таком сеансе покажет pg_temp_N, pg_catalog, app, public. Запросы и INSERT без имени схемы пойдут во временную таблицу: частая причина «пропавших» данных.', '{"A":"Квалифицированное имя не зависит от пути поиска.","B":"Схема app стоит в пути после временной схемы.","C":"Неявная временная схема стоит в пути первой и перекрывает app.t.","D":"Имена заняты в каждой схеме отдельно, временная таблица создаётся в pg_temp_N."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'В сеансе выполнили SET search_path = app, public и переподключились к той же базе. В postgresql.conf, на уровне базы и роли search_path не задан. Какой путь будет в новом сеансе?', '{"A":"app, public, если схема app существует","B":"app, public: значение SET сохранилось","C":"\"$user\", public: значение по умолчанию","D":"Пустой путь до следующей команды SET"}'::jsonb, 'C', 'Чтобы путь сохранялся между сеансами, его задают для базы (ALTER DATABASE ... SET), для роли (ALTER ROLE ... SET) или для роли в базе. Писать его в postgresql.conf неудобно: схемы app может не быть в других базах.', '{"A":"Наличие схемы не сохраняет значение SET.","B":"SET действует до конца сеанса.","C":"Новый сеанс получает значение по умолчанию.","D":"Новый сеанс получает значение по умолчанию, а не пустой путь."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Администратор выполнил ALTER DATABASE appdb SET search_path = app, public. Что верно?', '{"A":"Путь начнёт действовать во всех базах кластера","B":"ALTER ROLE ... IN DATABASE appdb SET его перекроет","C":"Новые сеансы в appdb получат этот путь","D":"Открытые сеансы в appdb сразу получат этот путь"}'::jsonb, 'BC', 'При подключении значения применяются по возрастанию приоритета: postgresql.conf, база, роль, роль в базе. SET в сеансе действует поверх них до конца сеанса.', '{"A":"Значение относится к одной базе; для всего кластера служат postgresql.conf или ALTER SYSTEM.","B":"Настройка роли в конкретной базе приоритетнее настройки базы.","C":"Значение уровня базы применяется при подключении.","D":"Открытые сеансы сохраняют своё значение до переподключения."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 11 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
