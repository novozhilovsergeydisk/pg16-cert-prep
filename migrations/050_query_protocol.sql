-- Семь вопросов раздела «04. Общее устройство PostgreSQL» о простом и расширенном протоколе, подготовленных операторах и курсорах с пояснениями к каждому варианту.
-- Источник: scripts/questions/050_query_protocol.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY
-- https://www.postgresql.org/docs/16/query-path.html
-- https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/sql-prepare.html
-- https://www.postgresql.org/docs/16/view-pg-prepared-statements.html
-- https://www.postgresql.org/docs/16/sql-deallocate.html
-- https://www.postgresql.org/docs/16/sql-discard.html
-- https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
-- https://www.postgresql.org/docs/16/sql-declare.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Клиент каждый раз отправляет полный текст обычного SELECT сообщением простого протокола, без PREPARE и EXECUTE. Какие этапы обработки проходит запрос при каждой такой отправке?', '{"A":"Только выполнение: разобранный текст сервер хранит с прошлой отправки","B":"Разбор и выполнение; планирование выполняется один раз на сеанс","C":"Разбор и планирование; выполнение откладывается до команды EXECUTE","D":"Разбор, переписывание, планирование и выполнение — все этапы каждый раз"}'::jsonb, 'D', 'Простой протокол: одно сообщение с текстом запроса, в ответ сразу результат. Часто повторяющийся запрос выгоднее подготовить: тогда разбор и переписывание выполняются один раз.', '{"A":"Разобранный запрос хранится только у подготовленного оператора, а здесь его нет.","B":"Для каждого так отправленного запроса план строится заново.","C":"EXECUTE нужен для подготовленного оператора; такой SELECT выполняется сразу при обработке сообщения.","D":"Такой запрос не связан ни с чем сохранённым, поэтому каждая отправка обрабатывается заново."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Таблица t (id int PRIMARY KEY) пуста. Выполнена команда psql -c "INSERT INTO t VALUES (1); INSERT INTO t VALUES (1);" без BEGIN в тексте. Что окажется в таблице?', '{"A":"Ничего: обе команды ушли одним сообщением простого протокола и выполнялись в одной транзакции, ошибка второй отменила и первую","B":"Команда не выполнится: в одном сообщении можно отправить только один запрос","C":"Одна строка: первая команда зафиксирована отдельно, вторая завершилась ошибкой","D":"Две строки: в одном сообщении первичный ключ проверяется только в конце"}'::jsonb, 'A', 'Из-за неявной транзакции в такой строке нельзя выполнить команды, которые не работают внутри блока транзакции, например VACUUM.', '{"A":"В этом примере обе вставки входят в одну неявную транзакцию: в тексте нет BEGIN и COMMIT, и блок транзакции не открыт. Ошибка второй откатывает первую.","B":"Простой протокол допускает несколько команд через точку с запятой; одну команду допускает сообщение Parse расширенного протокола.","C":"Так было бы при отдельных запросах с включённым AUTOCOMMIT и без открытого блока транзакции: например, интерактивный psql отправляет команды по одной, даже если они набраны в одной строке.","D":"Первичный ключ проверяется сразу при вставке строки, а даже отложенная проверка не позволила бы зафиксировать повтор."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Что происходит при выполнении команды PREPARE и затем EXECUTE этого подготовленного оператора?', '{"A":"PREPARE выполняет разбор и переписывание; при EXECUTE строится план или берётся сохранённый общий, и запрос выполняется","B":"PREPARE только запоминает текст; разбор, переписывание и планирование выполняются при каждом EXECUTE","C":"PREPARE строит план; разбор и переписывание повторяются при каждом EXECUTE","D":"PREPARE выполняет все этапы, включая выполнение; EXECUTE возвращает сохранённый результат"}'::jsonb, 'A', 'Частный план строится при каждом EXECUTE под значения параметров, общий — один раз и затем переиспользуется; выбор по умолчанию делает сервер (plan_cache_mode = auto). Если параметров нет, сразу используется общий план: он строится при первом EXECUTE. Если изменилась схема, сервер сам заново разберёт подготовленный запрос.', '{"A":"Подготовка экономит повторный разбор и переписывание, а при общем плане — и планирование.","B":"Тогда подготовка ничего бы не экономила; разбор и переписывание выполняются при PREPARE.","C":"PREPARE выполняет разбор и переписывание, а планирование — при EXECUTE, если нельзя взять сохранённый общий план.","D":"Результат не сохраняется: EXECUTE каждый раз выполняет запрос заново и видит данные по правилам видимости текущей транзакции."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Что верно о подготовленном операторе, созданном командой PREPARE?', '{"A":"Он удаляется в конце транзакции, в которой создан","B":"Его может выполнить только тот сеанс, который его создал","C":"Подготовленные операторы своего сеанса показывает представление pg_prepared_statements","D":"Он сохраняется между транзакциями до конца сеанса, если его не освободить раньше","E":"После создания его может выполнить любой сеанс той же базы"}'::jsonb, 'BCD', 'Поэтому при пуле соединений в режиме транзакций подготовленные операторы требуют осторожности: следующая транзакция клиента может попасть в другой сеанс.', '{"A":"PREPARE не привязан к транзакции: оператор остаётся даже после отката транзакции, в которой создан.","B":"Оператор хранится в локальной памяти обслуживающего процесса.","C":"В нём видны имя, текст, время создания и сколько раз выбирался общий и частный план (generic_plans, custom_plans).","D":"Освобождает оператор команда DEALLOCATE, а все операторы сеанса сразу — DISCARD ALL.","E":"Общего хранилища подготовленных операторов у сеансов нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Как команда PREPARE q(integer) AS SELECT * FROM t WHERE id = $1 соотносится со стандартом SQL?', '{"A":"Это команда psql, сервер её не понимает","B":"Это команда языка PL/pgSQL, в обычном SQL её нет","C":"Это расширение PostgreSQL: в стандарте PREPARE есть только для встроенного SQL и с другим синтаксисом","D":"Команда описана в стандарте SQL и одинаково работает во всех СУБД"}'::jsonb, 'C', 'Вне psql подготовленные операторы обычно создаёт драйвер средствами расширенного протокола, без SQL-команды PREPARE.', '{"A":"PREPARE выполняет сервер; команды psql начинаются с обратной косой черты.","B":"PREPARE — команда SQL; в PL/pgSQL запросы, наоборот, готовятся автоматически.","C":"Так сказано в разделе о совместимости в документации к PREPARE.","D":"Синтаксис подготовки операторов в разных СУБД различается; приложения обычно готовят операторы через драйвер."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Клиент впервые готовит и выполняет запрос с параметрами по расширенному протоколу. В каком порядке он отправляет сообщения Parse, Bind и Execute?', '{"A":"Bind, Parse, Execute","B":"Parse, Bind, Execute","C":"Parse, Execute, Bind","D":"Execute, Parse, Bind"}'::jsonb, 'B', 'При повторном выполнении того же оператора Parse не нужен: достаточно Bind и Execute. Портал — подготовленный оператор с привязанными значениями параметров, готовый к выполнению; в SQL ему соответствует курсор. Execute может получать строки порциями. Сообщение Sync завершает цикл: после него сервер фиксирует неявную транзакцию.', '{"A":"Связывать значения не с чем, пока текст не разобран.","B":"Parse создаёт подготовленный оператор, Bind связывает параметры со значениями и создаёт портал, Execute выполняет портал.","C":"Выполнить можно только портал, а его создаёт Bind.","D":"Выполнение идёт последним, когда запрос разобран и значения связаны с параметрами."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Курсор объявлен командой DECLARE c CURSOR FOR SELECT * FROM t внутри транзакции, без WITH HOLD. Сколько он существует?', '{"A":"До конца транзакции или до команды CLOSE","B":"До первой команды FETCH: курсор отдаёт строки один раз","C":"Без ограничения: курсор хранится в базе, как представление","D":"До конца сеанса"}'::jsonb, 'A', 'Курсор нужен, чтобы получать большой результат порциями, не держа его целиком в памяти клиента. Вне блока транзакции DECLARE без WITH HOLD выдаёт ошибку. В документации открытый курсор на сервере называется порталом.', '{"A":"После COMMIT или ROLLBACK такой курсор закрывается сам.","B":"FETCH можно выполнять многократно, получая строки порциями.","C":"Курсор принадлежит сеансу и не сохраняется как постоянный объект базы.","D":"Так живёт курсор WITH HOLD: он переживает успешный COMMIT и существует до CLOSE или конца сеанса, а при откате создавшей транзакции удаляется."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 7 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
