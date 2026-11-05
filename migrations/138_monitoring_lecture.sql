-- Двенадцать вопросов раздела «12. Мониторинг» по сверке с лекцией: update_process_title, счётчики после DELETE и VACUUM, статистика текущей транзакции, pg_statio, неиспользуемые индексы, pg_stat_reset, idle_in_transaction_session_timeout, завершение блокирующих сеансов, взаимоблокировка в журнале, log_min_messages и уровень LOG, процессы вне pg_stat_activity, pg_stat_io; пояснения к каждому варианту.
-- Источник: scripts/questions/138_monitoring_lecture.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/runtime-config-logging.html
-- https://www.postgresql.org/docs/16/monitoring-ps.html
-- https://www.postgresql.org/docs/16/monitoring-stats.html
-- https://www.postgresql.org/docs/16/runtime-config-client.html
-- https://www.postgresql.org/docs/16/functions-admin.html
-- https://www.postgresql.org/docs/16/functions-info.html
-- https://www.postgresql.org/docs/16/explicit-locking.html
-- https://www.postgresql.org/docs/16/runtime-config-locks.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'На Linux в выводе ps обслуживающие процессы выглядят так: «postgres: 16/main: alice appdb [local]» — без idle, SELECT или idle in transaction. Какой параметр выключен?', '{"A":"track_activities","B":"track_activity_query_size","C":"update_process_title","D":"cluster_name"}'::jsonb, 'C', 'update_process_title включён по умолчанию везде, кроме Windows. Имя кластера в заголовке задаёт cluster_name; в пакетах Debian и Ubuntu оно вида 16/main.', '{"A":"Параметр управляет данными в pg_stat_activity, а заголовок процесса в ОС не трогает.","B":"Задаёт, сколько байт текста запроса хранить для pg_stat_activity; на заголовок процесса в ОС не влияет.","C":"С ним сервер дописывает в заголовок процесса текущее состояние. В опыте после выключения осталась строка без состояния.","D":"Имя кластера в заголовке есть — 16/main; на состояние процесса параметр не влияет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'В новую таблицу t (автоочистка для неё выключена, других сеансов нет) вставили 100 строк, затем DELETE FROM t удалил все, потом выполнили VACUUM t. Параметры статистики по умолчанию, команды выполнены по отдельности в режиме автофиксации. Через пару секунд в новом сеансе запросили pg_stat_user_tables для t. Что покажет запрос?', '{"A":"n_tup_ins = 0, n_tup_del = 0","B":"n_dead_tup = 0","C":"n_live_tup = 100","D":"n_tup_ins = 100, n_tup_del = 100"}'::jsonb, 'BD', 'Это первая практика курса. В опыте до VACUUM было n_live_tup 0 и n_dead_tup 100, после — n_dead_tup 0, а n_tup_ins и n_tup_del остались по 100. Процессы передают статистику в общую память не чаще раза в секунду, а прочитанные значения по умолчанию кешируются до конца транзакции, поэтому цифры появляются с задержкой.', '{"A":"VACUUM не сбрасывает накопительные счётчики, их сбрасывает pg_stat_reset().","B":"Очистка удалила мёртвые версии, и оценка их числа обнулилась; vacuum_count стал 1.","C":"n_live_tup — оценка текущего числа живых строк: после DELETE она 0, и VACUUM её не меняет.","D":"Это накопительные счётчики операций: очистка их не уменьшает."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Сеанс A открыл транзакцию и вставил в t 10 строк, COMMIT ещё не было. Где сеанс A увидит эти 10 вставок?', '{"A":"В pg_stat_xact_user_tables своего сеанса","B":"В pg_stat_activity, в столбце n_tup_ins","C":"Нигде: до COMMIT вставки не учитываются","D":"В pg_stat_user_tables, сразу после INSERT"}'::jsonb, 'A', 'После конца транзакции её счётчики переходят в накопительную статистику: в опыте n_tup_ins в pg_stat_user_tables вырос со 100 до 110 после COMMIT. Есть представления для всех, пользовательских и системных объектов: pg_stat_all_tables, pg_stat_user_tables, pg_stat_sys_tables.', '{"A":"Представления pg_stat_xact_* показывают статистику текущей транзакции, ещё не переданную в накопительную.","B":"В pg_stat_activity нет счётчиков строк: там состояние и текущий запрос процесса.","C":"Счётчики текущей транзакции видны в pg_stat_xact_user_tables ещё до фиксации.","D":"Накопительная статистика получит эти вставки после конца транзакции: в опыте до COMMIT другой сеанс видел прежнее число."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Нужно узнать, сколько обращений к страницам таблицы orders с начала сбора статистики прошло мимо буферного кеша, а сколько нашли страницу в нём. Где смотреть?', '{"A":"pg_stat_user_tables: seq_tup_read и idx_tup_fetch","B":"pg_stat_database: blks_read и blks_hit по базе","C":"pg_stat_io: reads и hits для object = relation","D":"pg_statio_user_tables: heap_blks_read и heap_blks_hit"}'::jsonb, 'D', 'В pg_stat_user_tables счётчики в строках (seq_tup_read, idx_tup_fetch), в pg_statio_user_tables — в страницах: для таблицы, её индексов и toast-таблицы. Повторное обращение к той же странице считается снова. В демонстрации курса так сравнивали обращения к pgbench_accounts.', '{"A":"Эти счётчики считают строки, а не страницы, и не различают кеш и чтение.","B":"Здесь те же счётчики, но по всей базе, а не по одной таблице.","C":"pg_stat_io делит ввод-вывод по типам процессов и контекстам, а не по отдельным таблицам.","D":"heap_blks_read — чтения страниц, запрошенных у ОС (они могли прийти из её кеша), heap_blks_hit — попадания в буферный кеш."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'После месяца работы нужно найти индексы, которыми запросы не пользовались. Статистику за это время не сбрасывали, аварийных остановок не было, параметры сбора статистики по умолчанию. Где смотреть?', '{"A":"pg_index, где indisvalid = false","B":"pg_stat_user_indexes, где idx_scan = 0","C":"pg_statio_user_indexes, где idx_blks_read = 0","D":"pg_stat_user_tables, где idx_scan = 0"}'::jsonb, 'B', 'Лишние индексы замедляют изменение данных. Но перед удалением проверяют назначение индекса: индекс первичного ключа или уникальный нужен ограничению и при idx_scan = 0. Счётчик учитывает только этот сервер: сканирования на репликах в нём не видны.', '{"A":"Так отмечены недостроенные индексы, например после сбоя CREATE INDEX CONCURRENTLY, а не неиспользуемые.","B":"Счётчик растёт при каждом сканировании индекса; ноль за месяц — повод разобраться, нужен ли индекс.","C":"Ноль бывает и без обращений, и когда все обращения нашли страницы в кеше; сканирований этот счётчик не считает.","D":"Счётчик таблицы суммирует все её индексы и не покажет, какой из них лишний."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'В кластере базы appdb и crm. Суперпользователь, подключённый к appdb, выполнил SELECT pg_stat_reset(). Что сбросится?', '{"A":"Счётчики всех баз кластера, и appdb, и crm","B":"Счётчики объектов и самой базы appdb","C":"Счётчики, накопленные текущим сеансом","D":"Счётчики текущей базы и pg_stat_io"}'::jsonb, 'B', 'В демонстрации курса перед нагрузкой pgbench сбросили и статистику базы, и статистику ввода-вывода: pg_stat_reset() и pg_stat_reset_shared(''io'').', '{"A":"Статистика других баз остаётся: в опыте счётчики таблицы в другой базе не изменились.","B":"Функция сбрасывает накопительную статистику текущей базы: в опыте у неё обновилось stats_reset в pg_stat_database.","C":"Сбрасываются общие для всех сеансов счётчики базы, а не данные одного сеанса.","D":"Общие для кластера счётчики сбрасывает pg_stat_reset_shared, например pg_stat_reset_shared(''io'')."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Допишите настройку, чтобы сервер сам завершал сеансы, которые больше 5 минут простаивают в открытой транзакции и держат блокировки:
```
ALTER SYSTEM SET ___ = ''5min'';
```', '{"A":"`idle_in_transaction_session_timeout`","B":"`lock_timeout`","C":"`idle_session_timeout`","D":"`statement_timeout`"}'::jsonb, 'A', 'После ALTER SYSTEM нужно перечитать конфигурацию. Сеанс в idle in transaction мешает не только тем, кто ждёт его блокировки: открытая транзакция с номером удерживает горизонт очистки.', '{"A":"Сеанс, простоявший в открытой транзакции дольше заданного, завершается, а транзакция откатывается: в опыте сеанс закрылся через 2 секунды.","B":"Ограничивает ожидание блокировки: прерывает команду того, кто ждёт, а держатель блокировки остаётся.","C":"Действует на простой вне транзакции: в опыте сеанс в открытой транзакции он не тронул.","D":"Ограничивает время выполнения команды, а сеанс в idle in transaction ничего не выполняет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Сеанс 17673 ждёт блокировку, а блокирующий его сеанс простаивает в состоянии idle in transaction. Допишите запрос, чтобы освободить блокировку:
```
SELECT ___(b) FROM unnest(pg_blocking_pids(17673)) AS b;
```', '{"A":"`pg_cancel_backend`","B":"`pg_blocking_pids`","C":"`pg_log_backend_memory_contexts`","D":"`pg_terminate_backend`"}'::jsonb, 'D', 'pg_blocking_pids возвращает массив, потому что ожидающего могут блокировать несколько процессов; unnest разворачивает его в строки. Так завершали сеанс в демонстрации курса, в журнале появилось FATAL о закрытии подключения по команде администратора.', '{"A":"Отменяет выполняемую команду, а сеанс в idle in transaction ничего не выполняет: в опыте отмена ничего не изменила.","B":"Эта функция уже стоит в запросе: она возвращает массив PID блокирующих процессов, а не завершает их.","C":"Пишет в журнал сведения о памяти процесса, а сам сеанс не трогает.","D":"Завершает блокирующий сеанс, его транзакция откатывается и блокировки снимаются: в опыте ожидающий UPDATE сразу выполнился."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Две транзакции изменили строки крест-накрест, и сервер прервал одну из них с ошибкой «обнаружена взаимоблокировка». Все параметры по умолчанию, log_lock_waits выключен. Где найти тексты команд, на которых оба процесса ждали друг друга?', '{"A":"Нигде: без log_lock_waits ошибка не журналируется","B":"В сообщении клиенту, вместе с PID процессов","C":"В журнале сервера, в подробностях ошибки","D":"В pg_locks, в строках с granted = false"}'::jsonb, 'C', 'Это вторая практика курса. Ожидающий процесс через deadlock_timeout (по умолчанию 1 с) проверяет, нет ли взаимоблокировки, и прерывает свою транзакцию; вторая продолжает работу. В опыте журнал содержал строки «Процесс N: UPDATE …» для обоих процессов. Длинный текст команды обрезается по track_activity_query_size.', '{"A":"Ошибка уровня ERROR пишется при log_min_messages по умолчанию (warning). log_lock_waits — про долгие ожидания.","B":"Клиент видит PID и ожидаемые блокировки, а вместо команд — подсказку смотреть протокол сервера.","C":"В журнал пишется DETAIL с текущей командой каждого участника, а не со всеми командами транзакций. Клиент получает те же подробности без текстов команд.","D":"В pg_locks нет текстов команд, а после ошибки ожидание уже снято."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'log_min_messages = error, log_checkpoints = on, остальные параметры журнала по умолчанию. Какие сообщения попадут в журнал сервера?', '{"A":"Замечания уровня NOTICE, например от DROP IF EXISTS","B":"Ошибка «деление на ноль» уровня ERROR","C":"Предупреждения RAISE WARNING из функций PL/pgSQL","D":"Сообщения LOG о начале и конце контрольных точек"}'::jsonb, 'BD', 'log_min_messages отсекает сообщения ниже заданного уровня. Порядок для журнала сервера: DEBUG5…DEBUG1, INFO, NOTICE, WARNING, ERROR, LOG, FATAL, PANIC. LOG здесь выше ERROR, а для клиента, в client_min_messages, — ниже NOTICE.', '{"A":"NOTICE ниже порога и в журнал не попадает; клиенту его показывает client_min_messages.","B":"Уровень ERROR не ниже порога error.","C":"WARNING ниже ERROR и при пороге error отбрасывается: в опыте RAISE WARNING в журнал не попал.","D":"Для журнала сервера LOG стоит выше ERROR, поэтому такие сообщения пишутся и при пороге error."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Коллектор сообщений включён. Вы сравниваете процессы экземпляра в ps с выводом SELECT pid, backend_type FROM pg_stat_activity. Каких процессов нет в pg_stat_activity?', '{"A":"checkpointer, процесс контрольных точек","B":"postmaster, головной процесс экземпляра","C":"logger, процесс коллектора сообщений","D":"autovacuum launcher, планировщик автоочистки"}'::jsonb, 'BC', 'В демонстрации курса список дочерних процессов головного процесса в ps сравнивали с pg_stat_activity. В представлении видны и обслуживающие процессы клиентов (client backend), и фоновые процессы.', '{"A":"Фоновые процессы видны с backend_type: в опыте checkpointer был в списке.","B":"У головного процесса нет строки в pg_stat_activity; его PID записан в первой строке postmaster.pid.","C":"Коллектор сообщений в pg_stat_activity не показывается: в опыте ps его видел, а представление — нет.","D":"Виден с backend_type = autovacuum launcher, как и другие фоновые процессы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '12.'), 'Нужно сравнить, сколько чтений мимо буферного кеша выполняют обслуживающие процессы клиентов, а сколько — рабочие процессы автоочистки. Какое представление даёт это одним запросом?', '{"A":"pg_stat_activity, с полем wait_event","B":"pg_statio_all_tables, по всем таблицам","C":"pg_stat_database, со столбцом blks_read","D":"pg_stat_io, с разбивкой по backend_type"}'::jsonb, 'D', 'В демонстрации курса после CHECKPOINT суммировали reads, writes и hits из pg_stat_io по каждому типу процесса. Сбросить эти счётчики можно функцией pg_stat_reset_shared(''io'').', '{"A":"Там текущие ожидания процессов, а не накопленные счётчики ввода-вывода.","B":"Счётчики там по таблицам, а не по типам процессов.","C":"Счётчики по базам, без разделения на типы процессов.","D":"Представление появилось в 16-й версии: ввод-вывод по типам процессов, объектам и контекстам."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 12 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
