-- Десять вопросов раздела «18. Память процесса» о процессах PostgreSQL, общей памяти в /proc/PID/maps и полях VmSize, VmRSS, VmSwap с пояснениями к каждому варианту.
-- Источник: scripts/questions/041_postgres_processes_vm.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/connect-estab.html
-- https://www.postgresql.org/docs/16/runtime-config-error-handling.html
-- https://man7.org/linux/man-pages/man5/proc_pid_status.5.html
-- https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html
-- https://www.postgresql.org/docs/16/runtime-config-resource.html#GUC-SHARED-BUFFERS
-- https://www.postgresql.org/docs/16/kernel-resources.html
-- https://man7.org/linux/man-pages/man5/proc_pid_smaps.5.html
-- https://www.postgresql.org/docs/16/kernel-resources.html#LINUX-HUGE-PAGES
-- https://www.postgresql.org/docs/16/app-psql.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'В выводе ps для кластера PostgreSQL виден главный процесс, несколько фоновых процессов и процессы вида «postgres: 16/main: user db host idle». Какие утверждения верны?', '{"A":"Фоновые процессы запускает клиент при первом запросе","B":"Главный процесс (postmaster) порождает остальные процессы сервера","C":"Каждое клиентское подключение обслуживает отдельный процесс","D":"Каждое подключение обслуживает отдельный поток внутри одного процесса postgres","E":"checkpointer, background writer, walwriter и autovacuum launcher — фоновые процессы кластера"}'::jsonb, 'BCE', 'Модель «процесс на подключение» изолирует приватную память: сбой одного обслуживающего процесса не портит приватную память другого. Общую память процессы используют вместе, поэтому при аварии процесса postmaster завершает остальные процессы, подключённые к ней, и при включённом restart_after_crash запускает восстановление. Цена изоляции — у каждого подключения своя локальная память. Главный процесс без аргументов запуска и его непосредственные дочерние процессы: P=$(head -1 /var/lib/postgresql/16/main/postmaster.pid); ps -o pid,comm -p $P; ps -o pid,ppid,cmd --ppid $P', '{"A":"Они работают постоянно, клиент их не запускает.","B":"Он принимает подключения и запускает обслуживающие и фоновые процессы.","C":"Процессы вида «user db host idle» — это обслуживающие процессы, по одному на подключение.","D":"PostgreSQL использует процессы, а не потоки: в /proc/PID/status у них Threads: 1.","E":"Они запускаются вместе с сервером и работают независимо от клиентов."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Почему у процессов PostgreSQL в /proc/PID/status стоит Threads: 1?', '{"A":"Поток создаётся только на время выполнения запроса","B":"В /proc скрыты все потоки, кроме главного","C":"Потоки отключены параметром max_worker_processes","D":"PostgreSQL использует модель «процесс на подключение», а не потоки"}'::jsonb, 'D', 'Из-за этого память подключения, то есть куча и стек, принадлежит одному процессу, а общая память подключается ко всем процессам отдельно. Проверка: grep Threads /proc/PID/status, где PID — номер процесса, например главного: head -1 /var/lib/postgresql/16/main/postmaster.pid', '{"A":"Для выполнения запросов PostgreSQL потоки не создаёт.","B":"Поле Threads показывает число всех потоков процесса.","C":"Этот параметр ограничивает число фоновых рабочих процессов, а не потоков.","D":"Каждый обслуживающий и фоновый процесс однопоточный; параллельные запросы тоже используют отдельные процессы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'В /proc/PID/maps главного процесса PostgreSQL есть такие области. Какая из них разделяемая, то есть общая для процессов сервера?', '{"A":"7f72b6d62000-7f72bfc00000 rw-s 00000000 00:01 1025 /dev/zero (deleted)","B":"7f58aa3f3000-7f58aa549000 r-xp 00026000 fe:01 1478 /usr/lib/x86_64-linux-gnu/libc.so.6","C":"563c01115000-563c01136000 rw-p 00000000 00:00 0 [heap]","D":"7ffd8b4e1000-7ffd8b502000 rw-p 00000000 00:00 0 [stack]"}'::jsonb, 'A', 'Права rw-s обозначают разделяемую область с чтением и записью. Основная общая область PostgreSQL создаётся при запуске сервера и содержит shared_buffers и другие общие структуры, но одного признака rw-s мало, чтобы определить назначение области: таких областей у сервера может быть несколько. Приватные области (последняя буква p) у каждого процесса свои. Общие области главного процесса: grep rw-s /proc/PID/maps (PID — первая строка postmaster.pid).', '{"A":"Права rw-s: чтение и запись, область общая (s). Такая область остаётся общей для процессов, порождённых через fork.","B":"Это код библиотеки (r-xp): только чтение и выполнение, область приватная.","C":"Это куча процесса: область приватная (p), у каждого процесса своя.","D":"Это стек процесса, тоже приватный."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Параметр shared_buffers равен 128MB, а основная общая область в /proc/PID/maps главного процесса — около 143 МБ. Почему она больше?', '{"A":"maps округляет размеры вверх на 10%","B":"PostgreSQL считает мегабайты по 1000 КБ, а maps — по 1024 КБ","C":"В общей памяти лежат не только буферы данных, но и другие структуры: буферы журнала предзаписи, таблица блокировок, статусы транзакций","D":"В общую область входит локальная память всех обслуживающих процессов"}'::jsonb, 'C', 'shared_buffers — главная, но не единственная часть общей памяти. Параметры вроде wal_buffers и max_connections тоже влияют на её размер. Настройки: SHOW shared_buffers; SHOW wal_buffers; SHOW max_connections;. Размер области: grep rw-s /proc/PID/maps.', '{"A":"maps показывает точный диапазон адресов области, округляя только до границы страницы.","B":"PostgreSQL тоже считает 1 МБ как 1024 КБ: единицы одинаковы.","C":"Размер общей области складывается из shared_buffers и этих дополнительных структур.","D":"Локальная память процесса, например work_mem, в общую область не входит."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'На сервере работает 20 процессов postgres, у каждого VmRSS около 8 МБ. Сколько оперативной памяти они занимают суммарно?', '{"A":"Больше 160 МБ: к сумме нужно добавить shared_buffers","B":"Ровно 160 МБ","C":"Столько, сколько показывает сумма VmSize","D":"По этим данным точно не сказать: общие страницы посчитаны в RSS нескольких процессов, поэтому простая сумма обычно завышает расход"}'::jsonb, 'D', 'Точнее считает показатель PSS в /proc/PID/smaps_rollup: он делит учитываемые общие страницы поровну между процессами, которые ими пользуются. Память HugeTLB (большие страницы, выделенные заранее), которую PostgreSQL может использовать для общей области, не входит ни в RSS, ни в PSS: её показывает поле HugetlbPages в /proc/PID/status. Команды: grep Pss /proc/PID/smaps_rollup для процесса и ps -u postgres -o rss= | awk ''{s+=$1} END {print s/1024}'' для суммы RSS в МБ.', '{"A":"Обычная общая область уже частично входит в RSS процессов, которые к ней обращались, поэтому прибавлять её целиком нельзя.","B":"Сложение RSS не даёт точного значения: общие страницы учтены у каждого процесса.","C":"VmSize — это зарезервированные адреса, а не занятая память.","D":"Общие страницы (например, shared_buffers) входят в RSS каждого процесса, который к ним обращался. Кроме того, VmRSS — приблизительный счётчик, а память HugeTLB в него не входит."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Допишите команду psql, чтобы передать оболочке номер серверного процесса, обслуживающего это подключение. Номер перед этим сохранён командой SELECT pg_backend_pid() AS pid \gset:
```
\___ MYPID :pid
\! grep VmRSS /proc/$MYPID/status
```', '{"A":"`getenv`","B":"`export`","C":"`set`","D":"`setenv`"}'::jsonb, 'D', 'Так из сеанса psql можно заглянуть в /proc/PID/status серверного процесса этого подключения, а не самого psql. Опыт рассчитан на psql, запущенный на том же сервере Linux, что и PostgreSQL, с правом читать status этого процесса. Переменные psql и окружение оболочки — разные вещи. Порядок в psql: SELECT pg_backend_pid() AS pid \gset, затем \setenv MYPID :pid, затем \! grep -E "VmRSS|VmSwap" /proc/$MYPID/status.', '{"A":"Читает переменную окружения в переменную psql, а не наоборот.","B":"Это команда оболочки, в psql её нет.","C":"Задаёт переменную psql, а не переменную окружения для оболочки.","D":"Задаёт переменную окружения, которую увидят команды оболочки, запущенные из psql."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что показывает поле VmSize в /proc/PID/status?', '{"A":"Объём оперативной памяти, который процесс занимает сейчас","B":"Максимальный объём памяти, который процессу разрешено занять","C":"Объём страниц процесса, вытесненных в своп","D":"Размер виртуального адресного пространства процесса: все зарезервированные адреса, в том числе ещё не занятые оперативной памятью"}'::jsonb, 'D', 'VmSize учитывает размеры всех отображений независимо от того, находятся ли их страницы в оперативной памяти. Поэтому большой VmSize не означает такого же расхода оперативной памяти. Команда: grep VmSize /proc/PID/status; для своей оболочки — grep VmSize /proc/$$/status.', '{"A":"Это VmRSS.","B":"Лимиты задают ulimit и cgroup (например, MemoryMax); VmSize — фактический размер адресного пространства.","C":"Это VmSwap.","D":"Сюда входят код, данные, куча, стек, библиотеки и отображённые файлы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что показывает поле VmRSS в /proc/PID/status?', '{"A":"Объём страниц процесса, вытесненных в своп","B":"Объём только приватных страниц процесса без общих","C":"Объём страниц процесса, которые сейчас находятся в оперативной памяти (resident set size)","D":"Размер файла программы на диске"}'::jsonb, 'C', 'RSS быстро читается, но это приблизительный счётчик, и для учёта общей памяти он неточен: общие страницы засчитываются каждому процессу. Точнее считает PSS: он делит учитываемые общие страницы между процессами, а память HugeTLB учитывают отдельно. Команды: grep VmRSS /proc/PID/status и точнее для общей памяти grep -E "Rss|Pss" /proc/PID/smaps_rollup.', '{"A":"Это VmSwap.","B":"Так считается USS; RSS включает и общие страницы, к которым процесс обращался.","C":"Сюда входят приватные страницы и общие страницы, к которым процесс обращался.","D":"Размер файла к полю VmRSS отношения не имеет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Что показывает поле VmSwap в /proc/PID/status?', '{"A":"Объём свободного места в свопе всей системы","B":"Объём страниц процесса в оперативной памяти","C":"Объём приватных страниц процесса, которые сейчас находятся в свопе","D":"Объём свопа, который процессу разрешено использовать"}'::jsonb, 'C', 'VmSwap показывает, сколько приватной анонимной памяти процесса лежит в свопе. Ненулевое значение не значит, что процесс сейчас обращается к свопу, а рост не доказывает нехватку памяти всей системы: причиной может быть, например, лимит службы. Для диагностики смотрят ещё обмен со свопом: в выводе vmstat 1 столбец si показывает, сколько данных в секунду возвращается из свопа, so — сколько уходит в своп; первая строка — средние с запуска системы. Давление на память (cat /proc/pressure/memory) показывает, какую долю времени задачи задерживались из-за нехватки памяти. Команды: grep VmSwap /proc/PID/status; свободный своп системы — grep -E "SwapTotal|SwapFree" /proc/meminfo или free -m.', '{"A":"Это SwapFree в /proc/meminfo.","B":"Это VmRSS.","C":"Своп общей памяти (shmem) в это поле не входит.","D":"Этот предел задаётся, например, параметром MemorySwapMax службы systemd, а не полем status."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '18.'), 'Процесс не использует HugeTLB. У него VmSize равен 439 МБ, VmRSS — 15 МБ, VmSwap — 1 МБ. Что из этого верно?', '{"A":"Процесс зарезервировал адресов намного больше, чем занимает оперативной памяти; около 1 МБ его приватных страниц находится в свопе","B":"Большой VmSize доказывает утечку памяти в процессе","C":"Процесс использует 15 + 1 = 16 МБ виртуального адресного пространства","D":"Процесс занимает в оперативной памяти 439 МБ"}'::jsonb, 'A', 'Ни большой VmSize, ни рост VmRSS сами по себе утечку не доказывают: память растёт и от кеширования, и от нагрузки. Подозрение вызывает устойчивый рост удерживаемой памяти при сопоставимой нагрузке; причину ищут по выделениям памяти, в PostgreSQL — по контекстам памяти. Все три поля сразу: grep -E "VmSize|VmRSS|VmSwap" /proc/PID/status.', '{"A":"VmSize — адреса, VmRSS — страницы в оперативной памяти, VmSwap — приватные страницы в свопе.","B":"Адреса резервируются заранее, файлы отображаются целиком; сам по себе большой VmSize признаком утечки не является.","C":"Виртуальное адресное пространство — это VmSize, 439 МБ.","D":"Столько адресов зарезервировано; в оперативной памяти находятся около 15 МБ."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 10 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
