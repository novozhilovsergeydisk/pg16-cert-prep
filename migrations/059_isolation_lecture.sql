-- Шесть вопросов раздела «05. Изоляция и многоверсионность» по сверке с лекцией: xmax у ещё видимой версии, номер текущей транзакции, видимость версий по статусам xmin и xmax, буферы clog, горизонт очистки и другая таблица, ожидание UPDATE на разных уровнях; пояснения к каждому варианту.
-- Источник: scripts/questions/059_isolation_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/ddl-system-columns.html
-- https://www.postgresql.org/docs/16/mvcc-intro.html
-- https://www.postgresql.org/docs/16/functions-info.html
-- https://www.postgresql.org/docs/16/monitoring-stats.html#MONITORING-PG-STAT-SLRU-VIEW
-- https://www.postgresql.org/docs/16/storage-file-layout.html
-- https://www.postgresql.org/docs/16/routine-vacuuming.html
-- https://www.postgresql.org/docs/16/transaction-iso.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Транзакция A на уровне Read Committed прочитала строку. Транзакция B изменила эту строку командой UPDATE и ещё не зафиксировала изменения. A снова выполняет SELECT xmin, xmax, * FROM t. Что она увидит?', '{"A":"Старую версию с xmax = 0, номер B появится там только после фиксации","B":"Старую версию строки, в её xmax уже записан номер транзакции B","C":"Новую версию, созданную транзакцией B","D":"Запрос будет ждать завершения транзакции B"}'::jsonb, 'B', 'Ненулевой xmax означает, что какая-то транзакция удалила или заменила эту версию. Видна ли версия, зависит от того, зафиксирована ли эта транзакция и попала ли в снимок. По служебным полям видно, что версия ещё видна, хотя уже не актуальна. Когда B зафиксирует изменения, следующий запрос A на Read Committed увидит новую версию.', '{"A":"xmax записывается сразу при UPDATE, а видимость решают снимок и статус B.","B":"B заменила версию, но её изменения ещё не зафиксированы, поэтому в снимок A они не попадают.","C":"Изменения незафиксированной транзакции в снимок не попадают.","D":"Чтение не ждёт блокировок строк."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Допишите запрос, чтобы узнать номер текущей транзакции:
```
SELECT ___;
```', '{"A":"`pg_current_snapshot()`","B":"`pg_current_xact_id()`","C":"`pg_backend_pid()`","D":"`pg_snapshot_xmin(pg_current_snapshot())`"}'::jsonb, 'B', 'Номер выдаётся не при BEGIN, а при первом изменении данных или при вызове pg_current_xact_id. Функция pg_current_xact_id_if_assigned вернёт NULL, если номера ещё нет. txid_current — устаревшее имя той же функции.', '{"A":"Возвращает снимок: границы и список активных транзакций.","B":"Если номера у транзакции ещё нет, функция его выдаст.","C":"Это PID обслуживающего процесса, а не номер транзакции.","D":"Это нижняя граница снимка: самая старая транзакция, которая ещё активна."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Снимок данных построен, когда все упомянутые транзакции уже завершились. Какие версии строки в него попадут?', '{"A":"Транзакция xmin зафиксирована, xmax = 0","B":"Транзакции xmin и xmax зафиксированы","C":"Транзакция xmin прервана","D":"Транзакция xmin зафиксирована, транзакция xmax прервана"}'::jsonb, 'AD', 'Статус транзакций из xmin и xmax берётся из clog. При откате версии строк остаются в странице, их пропускают правила видимости, а позже убирает очистка.', '{"A":"Актуальная версия: её никто не удалял и не заменял.","B":"Версию удалили или заменили до создания снимка.","C":"Версию создала отменённая транзакция, её как будто не было.","D":"Удаление или изменение отменено, версия остаётся актуальной."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Где хранятся в памяти последние страницы clog?', '{"A":"В отдельных буферах общей памяти, выделенных под clog","B":"В общем буферном кеше вместе со страницами таблиц","C":"Нигде: статус каждый раз читается с диска из pg_xact","D":"В локальной памяти каждого обслуживающего процесса"}'::jsonb, 'A', 'В clog на каждую транзакцию отводится два бита, файлы лежат в PGDATA/pg_xact. Чаще всего нужны последние страницы: по ним проверяют видимость свежих версий строк. Обращения к этим буферам показывает представление pg_stat_slru.', '{"A":"Ими пользуются все процессы.","B":"Буферный кеш хранит страницы таблиц и индексов, у clog свои буферы.","C":"Статусы проверяют очень часто, поэтому последние страницы держат в памяти.","D":"Статусы транзакций нужны всем процессам, поэтому буферы общие."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Транзакция на уровне Repeatable Read уже час строит отчёт по таблице t1 и не завершается. Таблица t2 в той же базе всё это время активно обновляется. Что сможет сделать очистка с t2?', '{"A":"Не сможет убрать версии строк t2, ставшие неактуальными после создания снимка долгой транзакции","B":"Будет ждать завершения долгой транзакции","C":"Очистит t2 полностью, ведь долгая транзакция работает только с t1","D":"Прервёт долгую транзакцию, чтобы сдвинуть горизонт"}'::jsonb, 'A', 'Горизонт очистки вычисляется для базы данных по самому старому снимку и самой старой активной транзакции. Долгая транзакция удерживает его для всех таблиц базы, в t2 копятся мёртвые версии, и таблица разрастается.', '{"A":"Горизонт очистки один на базу, и его держит снимок долгой транзакции, хотя она не обращается к t2.","B":"Очистка не ждёт: она оставляет нужные версии и идёт дальше.","C":"Очистка не знает, к каким таблицам транзакция обратится дальше.","D":"Очистка не прерывает транзакции."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Транзакция A изменила строку и ещё не завершилась. Транзакция B выполняет UPDATE той же строки и ждёт. Затем A фиксирует изменения. Что верно?', '{"A":"На любом уровне изоляции B завершится ошибкой","B":"На уровне Repeatable Read UPDATE в B завершится ошибкой сериализации","C":"B изменит старую версию строки, и изменения A пропадут","D":"На уровне Read Committed UPDATE в B продолжится: заново проверит условие WHERE на новой версии строки и, если условие выполняется, изменит её"}'::jsonb, 'BD', 'Так в лекции показано, что пишущие транзакции блокируют друг друга. Если бы A откатила изменения, B на любом уровне изменила бы исходную версию строки. На Serializable при фиксации A будет то же, что на Repeatable Read: ошибка «could not serialize access due to concurrent update».', '{"A":"На Read Committed ошибки не будет.","B":"Снимок B не видит изменений A, а менять версию, которой нет в снимке, нельзя. Транзакцию нужно повторить.","C":"Это было бы потерянное обновление, PostgreSQL его не допускает.","D":"Перепроверяется только эта строка, новый снимок не строится."}'::jsonb;

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
