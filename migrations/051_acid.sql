-- Семь вопросов к материалу ACID в темах 04, 05, 07 и 08: изоляция, ошибка в транзакции, чтение и запись, подтранзакции, full_page_writes, отложенные ограничения; пояснения к каждому варианту.
-- Источник: scripts/questions/051_acid.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/tutorial-transactions.html
-- https://www.postgresql.org/docs/16/transaction-iso.html
-- https://www.postgresql.org/docs/16/sql-savepoint.html
-- https://www.postgresql.org/docs/16/sql-rollback-to.html
-- https://www.postgresql.org/docs/16/app-psql.html
-- https://www.postgresql.org/docs/16/mvcc-intro.html
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS
-- https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED
-- https://www.postgresql.org/docs/16/subxacts.html
-- https://www.postgresql.org/docs/16/ddl-system-columns.html
-- https://www.postgresql.org/docs/16/runtime-config-wal.html#GUC-FULL-PAGE-WRITES
-- https://www.postgresql.org/docs/16/wal-reliability.html
-- https://www.postgresql.org/docs/16/wal-intro.html
-- https://www.postgresql.org/docs/16/sql-createtable.html
-- https://www.postgresql.org/docs/16/sql-set-constraints.html
-- https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'Что означает свойство транзакций «изоляция»?', '{"A":"Зафиксированные данные не теряются даже в случае сбоя","B":"Транзакции всегда выполняются строго по очереди, одна за другой","C":"Параллельно выполняемые транзакции влияют друг на друга только в пределах, которые допускает их уровень изоляции","D":"Транзакция выполняется полностью или не выполняется вовсе"}'::jsonb, 'C', 'Насколько строго транзакции изолированы, задаёт уровень изоляции: Read Committed (по умолчанию), Repeatable Read или Serializable.', '{"A":"Это долговечность.","B":"Транзакции выполняются параллельно; даже Serializable лишь гарантирует для зафиксированных транзакций результат, как при каком-то последовательном выполнении.","C":"В PostgreSQL для этого служат снимки данных и блокировки, а на уровне Serializable — ещё и отслеживание зависимостей между транзакциями.","D":"Это атомарность."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '04.'), 'В psql с настройками по умолчанию открыта транзакция; после SAVEPOINT s очередная команда завершилась ошибкой. Что верно?', '{"A":"Сервер сам откатится к точке сохранения s и продолжит транзакцию","B":"Следующие обычные команды сервер отклонит, пока транзакцию не откатят полностью или до точки сохранения","C":"Если сразу выполнить COMMIT, сервер откатит всю транзакцию и ответит ROLLBACK","D":"COMMIT зафиксирует изменения, сделанные до ошибки","E":"Команда ROLLBACK TO s отменит изменения после точки сохранения, и транзакцию можно продолжить"}'::jsonb, 'BCE', 'Точка сохранения позволяет отменить только ошибочную часть транзакции, а не всю её.', '{"A":"Сам сервер этого не делает. psql при ON_ERROR_ROLLBACK = on откатывается к своей служебной точке, поставленной перед ошибочной командой, а не к s.","B":"Ошибка переводит транзакцию в прерванное состояние; в стандартном приглашении psql появляется знак !.","C":"Прерванную транзакцию зафиксировать нельзя: отменятся и изменения, сделанные до ошибки.","D":"COMMIT без предварительного ROLLBACK TO не выводит транзакцию из прерванного состояния и откатывает всё. Чтобы сохранить работу до точки s, сначала выполняют ROLLBACK TO s, затем COMMIT.","E":"Изменения, сделанные до точки сохранения, останутся в транзакции, но будут зафиксированы только вместе с ней."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'Строка уже зафиксирована. Транзакция A изменила её командой UPDATE и ещё не завершилась. Второй сеанс работает на уровне Read Committed и обращается к этой строке. Что произойдёт?', '{"A":"Обычный SELECT этой строки будет ждать завершения транзакции A","B":"SELECT вернёт новое, ещё не зафиксированное значение","C":"UPDATE этой же строки сразу завершится ошибкой","D":"UPDATE этой же строки будет ждать завершения транзакции A","E":"Обычный SELECT этой строки не будет ждать блокировку и прочитает версию до изменения"}'::jsonb, 'DE', 'Правило многоверсионности: чтение не блокирует запись, а запись не блокирует чтение. Ждать приходится, когда две транзакции изменяют одну строку, или из-за блокировок таблиц, например при ALTER TABLE.', '{"A":"Многоверсионность позволяет читать без ожидания. Ждать может SELECT с блокирующим предложением, например FOR UPDATE или FOR SHARE, если запрошенная блокировка конфликтует с блокировкой A.","B":"Незафиксированные изменения других транзакций не видны ни на одном уровне изоляции.","C":"Второй UPDATE ждёт завершения A. После её фиксации он заново проверяет условие WHERE на новой версии строки и изменяет её, только если условие по-прежнему выполняется.","D":"Две записи в одну строку конфликтуют: вторая ждёт блокировку строки.","E":"Чтение берёт версию строки, подходящую по снимку, и блокировку строки не ждёт."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '05.'), 'В транзакции после SAVEPOINT s вставлена строка. Какой номер транзакции окажется в xmin этой строки?', '{"A":"Номер последней зафиксированной транзакции","B":"Собственный номер подтранзакции, отличный от номера основной транзакции","C":"Ноль, пока транзакция не зафиксирована","D":"Номер основной транзакции"}'::jsonb, 'B', 'Связь подтранзакции с основной транзакцией хранится в pg_subtrans; при фиксации основной транзакции её подтранзакции тоже получают статус «зафиксирована». Функция pg_current_xact_id() внутри подтранзакции показывает номер основной транзакции, а номер подтранзакции виден в xmin: SELECT xmin, * FROM t;', '{"A":"xmin — номер транзакции, создавшей версию строки, а не чужой транзакции.","B":"Вставляющая подтранзакция получает свой номер, он и записывается в xmin. Откат к точке s отменяет работу после неё, включая вложенные подтранзакции.","C":"xmin заполняется сразу при создании версии строки.","D":"В xmin записывается номер вставляющей подтранзакции; её связь с основной транзакцией учитывается отдельно."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '07.'), 'Зачем нужен параметр full_page_writes = on?', '{"A":"Первое изменение страницы после контрольной точки записывает в журнал её полную копию, чтобы после сбоя восстановить страницу, недописанную на диск","B":"Он включает запись полной копии страницы в журнал при каждом её изменении","C":"Он нужен только для логической репликации","D":"Он заставляет записывать на диск все изменённые страницы при каждом COMMIT"}'::jsonb, 'A', 'Поэтому сразу после контрольной точки объём журнала растёт. Выключать параметр можно, только если файловая система и диск гарантируют атомарную запись страниц; иначе после сбоя возможна порча данных. Проверка: SHOW full_page_writes;', '{"A":"Атомарность записи целой страницы на диск не гарантируется: при сбое питания может сохраниться лишь её часть.","B":"Полная копия нужна только при первом изменении страницы после контрольной точки; дальше пишутся обычные записи журнала.","C":"Этот механизм нужен для восстановления страниц после сбоя.","D":"COMMIT не требует сброса изменённых страниц данных; при обычной фиксации сервер ждёт сброса журнала. full_page_writes управляет записью полных копий страниц в журнал."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Ограничение объявлено как UNIQUE DEFERRABLE, без INITIALLY DEFERRED, и в транзакции не выполнялась команда SET CONSTRAINTS. Когда проверяется уникальность?', '{"A":"В конце каждой команды; для следующих команд проверку можно заранее отложить до конца транзакции командой SET CONSTRAINTS ... DEFERRED","B":"Никогда: DEFERRABLE отключает проверку уникальности","C":"Только в момент COMMIT","D":"При изменении каждой строки, как у обычного UNIQUE"}'::jsonb, 'A', 'Отложенными могут быть UNIQUE, PRIMARY KEY, EXCLUDE и внешние ключи, но не NOT NULL и CHECK. Пример: обмен значениями двух строк с уникальным столбцом одной командой UPDATE проходит только у ограничения DEFERRABLE.', '{"A":"DEFERRABLE без уточнения означает INITIALLY IMMEDIATE: по умолчанию проверка идёт в конце команды.","B":"DEFERRABLE разрешает отложить проверку, но не отключает её; пока режим не изменён, действует INITIALLY IMMEDIATE.","C":"Так будет при INITIALLY DEFERRED или после SET CONSTRAINTS ... DEFERRED, если затем не выполнить SET CONSTRAINTS ... IMMEDIATE.","D":"Так проверяется ограничение без DEFERRABLE; поэтому обмен значениями двух строк одной командой UPDATE у него не проходит."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '08.'), 'Внешний ключ объявлен DEFERRABLE INITIALLY DEFERRED. Чем в этом случае ON DELETE RESTRICT отличается от ON DELETE NO ACTION?', '{"A":"NO ACTION записывает NULL в ссылающиеся строки","B":"Ничем: эти действия всегда работают одинаково","C":"RESTRICT удаляет и ссылающиеся строки, а NO ACTION — нет","D":"Проверку NO ACTION можно отложить до конца транзакции, а проверку RESTRICT нельзя отложить за конец текущей команды, даже у отложенного ключа"}'::jsonb, 'D', 'NO ACTION — действие по умолчанию. Отложенная проверка позволяет в одной транзакции удалить строку, а потом убрать или перенаправить ссылки на неё; с RESTRICT так нельзя. CASCADE и SET NULL выполняются сразу, даже если ключ отложенный.', '{"A":"Это ON DELETE SET NULL.","B":"Действия различаются: проверку NO ACTION можно отложить, а RESTRICT — нельзя.","C":"Удаление ссылающихся строк — это ON DELETE CASCADE.","D":"При INITIALLY DEFERRED проверка NO ACTION по умолчанию ждёт COMMIT; SET CONSTRAINTS ... IMMEDIATE может вызвать её раньше. RESTRICT не откладывается."}'::jsonb;

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
