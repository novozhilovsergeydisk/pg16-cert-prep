-- Шесть вопросов раздела «04. Общее устройство PostgreSQL» по сверке с лекцией: AUTOCOMMIT, видимость своих изменений, этапы разбора, устройство страницы, расширяемость, правила переписывания; пояснения к каждому варианту.
-- Источник: scripts/questions/052_architecture_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/app-psql.html#APP-PSQL-VARIABLES
-- https://www.postgresql.org/docs/16/tutorial-transactions.html
-- https://www.postgresql.org/docs/16/transaction-iso.html
-- https://www.postgresql.org/docs/16/parser-stage.html
-- https://www.postgresql.org/docs/16/query-path.html
-- https://www.postgresql.org/docs/16/rules-views.html
-- https://www.postgresql.org/docs/16/storage-page-layout.html
-- https://www.postgresql.org/docs/16/pageinspect.html
-- https://www.postgresql.org/docs/16/storage-fsm.html
-- https://www.postgresql.org/docs/16/storage-vm.html
-- https://www.postgresql.org/docs/16/extend.html
-- https://www.postgresql.org/docs/16/sql-createextension.html
-- https://www.postgresql.org/docs/16/postgres-fdw.html
-- https://www.postgresql.org/docs/16/bgworker.html
-- https://www.postgresql.org/docs/16/rules.html
-- https://www.postgresql.org/docs/16/rules-triggers.html
-- https://www.postgresql.org/docs/16/sql-createrule.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'В psql выполнено \set AUTOCOMMIT off, затем команда INSERT INTO t VALUES (1); и больше ничего. Увидит ли эту строку другой сеанс?', '{"A":"Да: каждая команда фиксируется сразу после выполнения","B":"Да, но только после того, как другой сеанс сам выполнит COMMIT","C":"Нет: при AUTOCOMMIT off команды изменения данных запрещены до явного BEGIN","D":"Нет: psql сам открыл транзакцию перед INSERT, и пока не выполнен COMMIT, изменение не зафиксировано"}'::jsonb, 'D', 'AUTOCOMMIT — переменная psql, а не параметр сервера. Если закрыть psql без COMMIT, транзакция откатится. Режим фиксации драйвера в своём языке программирования тоже стоит выяснить заранее.', '{"A":"Так ведёт себя режим по умолчанию, AUTOCOMMIT on, для команды вне явно открытой транзакции.","B":"Чужой COMMIT не фиксирует изменения нашей транзакции; зафиксировать их может только наш сеанс.","C":"Команда выполнилась; запрета нет, просто транзакция осталась открытой.","D":"Если транзакция ещё не открыта, psql при AUTOCOMMIT off отправляет BEGIN перед INSERT. Изменение останется незафиксированным до явного COMMIT, а ROLLBACK его отменит."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Сеанс 1 выполнил BEGIN и вставил новую строку, но COMMIT ещё не выполнил. Кто видит эту строку?', '{"A":"Никто, включая сеанс 1, пока не выполнен COMMIT","B":"Только сеансы, работающие на уровне Read Uncommitted","C":"Все сеансы сразу после вставки","D":"Только сам сеанс 1: другим сеансам незафиксированная строка не видна"}'::jsonb, 'D', 'После COMMIT видимость строки для других транзакций зависит от их снимков: транзакция Read Committed увидит её в следующей команде, а транзакция Repeatable Read с уже взятым снимком — нет. Если сеанс 1 выполнит ROLLBACK, строку так никто и не увидит.', '{"A":"Транзакция видит собственные изменения, сделанные её предыдущими командами.","B":"В PostgreSQL Read Uncommitted ведёт себя как Read Committed: грязного чтения нет.","C":"Незафиксированные изменения чужих транзакций не видны ни на одном уровне изоляции.","D":"Следующие команды транзакции видят её собственную вставку ещё до COMMIT."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Какие ошибки сервер обнаруживает ещё на этапе синтаксического и семантического разбора запроса, до планирования и выполнения?', '{"A":"Опечатку в ключевом слове, например SELEKT вместо SELECT","B":"Обращение к таблице, которой нет в базе","C":"Вставку повторяющегося значения в столбец с ограничением UNIQUE","D":"Деление на ноль при вычислении выражения по значениям из строк таблицы","E":"Запрос не вернул ни одной строки"}'::jsonb, 'AB', 'Разбор включает лексический анализ (деление текста на слова и символы), синтаксический и семантический. Существование объекта и права на него — разные проверки: основные права на таблицы PostgreSQL проверяет при запуске выполнения, поэтому PREPARE запроса к таблице без прав проходит, а EXECUTE завершается ошибкой «нет доступа». Некоторые права, например на явно указанную схему, проверяются уже при разборе.', '{"A":"Слова не складываются в конструкцию языка SQL — это синтаксический разбор.","B":"Семантический разбор проверяет по системному каталогу, существуют ли упомянутые объекты.","C":"Конфликт уникальности выясняется при проверке ограничения по данным, а не при разборе; у отложенного ограничения — даже при COMMIT.","D":"Значения из строк таблицы становятся известны только при выполнении.","E":"Это не ошибка, а результат выполнения."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Как устроена страница обычной таблицы в PostgreSQL?', '{"A":"Версии строк идут подряд от начала страницы, заголовок хранится в её конце","B":"Заголовка нет: служебные сведения о страницах хранятся в отдельном файле","C":"В начале заголовок и массив указателей на версии строк, сами версии размещаются от конца страницы, свободное место — между ними","D":"Каждая версия строки занимает отдельную страницу"}'::jsonb, 'C', 'Указатель хранит смещение версии строки внутри страницы, поэтому при уплотнении страницы версию можно сдвинуть, не меняя ссылок на неё из индексов. Устройство страницы можно увидеть расширением pageinspect.', '{"A":"Заголовок всегда в начале страницы, а версии строк заполняют её с конца.","B":"У каждой страницы свой заголовок. Карты свободного места и видимости хранятся отдельно и заголовков не заменяют.","C":"Массив указателей растёт от начала страницы, область версий строк — навстречу ему. Для вставки нужно, чтобы хватило места на версию строки и её указатель.","D":"На странице (обычно 8 КБ) помещается много версий строк."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Что можно добавить в PostgreSQL расширениями, не меняя исходный код сервера?', '{"A":"Новые типы данных вместе с функциями, операторами и поддержкой индексирования","B":"Новые языки программирования для функций и процедур","C":"Обёртки сторонних данных, чтобы работать с внешним источником как с таблицей","D":"Многопоточную модель вместо отдельного процесса на каждое подключение","E":"Ничего: расширение устанавливается только пересборкой сервера"}'::jsonb, 'ABC', 'Расширяемость заложена в PostgreSQL изначально: можно добавлять также методы индексов, триггеры и фоновые процессы, например планировщик заданий внутри базы.', '{"A":"Так устроен, например, PostGIS: геометрические и географические типы, функции для них и индексы.","B":"Например, PL/Python или PL/Perl; можно подключать и другие языки.","C":"Например, postgres_fdw подключает таблицы другого сервера PostgreSQL, а file_fdw читает файл CSV на сервере.","D":"Расширение не заменяет обслуживающие процессы потоками, хотя может добавлять собственные фоновые процессы.","E":"После установки файлов объекты расширения создают в базе командой CREATE EXTENSION, пересборка не нужна. Отдельным модулям нужна загрузка при запуске сервера (shared_preload_libraries) и перезапуск."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Пользовательское правило CREATE RULE для INSERT, UPDATE или DELETE меняет обработку команды. На каком этапе оно применяется и что для сложной логики изменений обычно предпочитают?', '{"A":"На этапе разбора; вместо правил используют представления","B":"На этапе планирования; вместо правил используют подсказки планировщику","C":"На этапе выполнения; вместо правил используют ограничения целостности","D":"На этапе переписывания; для такой логики обычно предпочитают триггеры"}'::jsonb, 'D', 'Совет предпочитать триггеры относится к правилам изменения данных. На правилах ON SELECT работают обычные представления; создают их командой CREATE VIEW, а их правило видно в системном каталоге: SELECT rulename FROM pg_rewrite WHERE ev_class = ''имя_представления''::regclass; — это правило _RETURN.', '{"A":"Переписывание идёт после разбора. Представления сами реализованы правилами ON SELECT: на этапе переписывания ссылка на представление раскрывается в подзапрос в дереве запроса.","B":"Правила преобразуют запрос до планирования; настройки планировщика решают другую задачу.","C":"Правила преобразуют разобранный запрос ещё до планирования и выполнения.","D":"Поведение триггеров при изменении данных проще понять и предсказать."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 6 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
