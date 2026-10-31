-- Архив прежних версий: 31 вопросов тем 18–20 перед миграцией 120 (исправление странностей, materials/drafts/oddities-18-20.md).
-- Таблица question_archive создана миграцией 104; сайт её не читает.
-- Повторный запуск безопасен: вопрос копируется, только если его копии с этой причиной ещё нет. Вопросы ищутся по прежнему тексту:
-- номера на сервере и локально различаются. После миграции 120 прежних текстов уже нет, проверка в конце убедится, что в архиве все 31 копий.

BEGIN;
SET LOCAL standard_conforming_strings = on;
LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO question_archive (question_id, question_text, options, correct_answer, explanation, option_notes, reason)
SELECT q.id, q.question_text, q.options, q.correct_answer, q.explanation, q.option_notes, 'Темы 18–20: исправлены странности (миграция 120)'
FROM questions q
JOIN categories c ON c.id = q.category_id AND left(c.name, 3) IN ('18.', '19.', '20.')
WHERE q.question_text IN (
    'Что такое виртуальная память процесса?',
    'Что обычно хранится в стеке процесса?',
    'Что не так в этой функции?
```
int *make(void)
{
    int x = 42;
    return &x;
}
```',
    'Допишите код, чтобы вернуть память, выделенную через malloc:
```
char *buf = malloc(1024);
/* ... работа с buf ... */
___(buf);
```',
    'Какие утверждения о стеке и куче верны?',
    'Что верно для механизма OOM killer в Linux? PostgreSQL работает с restart_after_crash по умолчанию, postmaster продолжает работать.',
    'Что верно для приватных страниц памяти дочернего процесса, созданного вызовом fork() в Linux, если общая память явно не подключалась?',
    'В чём главное отличие стека от кучи?',
    'В /proc/PID/maps файл locale-archive занимает около 232 МБ адресов, а процесс занимает в оперативной памяти всего несколько мегабайт. Как это возможно?',
    'В /proc/PID/maps главного процесса PostgreSQL есть такие области. Какая из них разделяемая, то есть общая для процессов сервера?',
    'Допишите команду psql, чтобы передать оболочке номер серверного процесса, обслуживающего это подключение. Номер перед этим сохранён командой SELECT pg_backend_pid() AS pid \gset:
```
\___ MYPID :pid
\! grep VmRSS /proc/$MYPID/status
```',
    'Что показывает поле VmSize в /proc/PID/status?',
    'Процесс не использует HugeTLB. У него VmSize равен 439 МБ, VmRSS — 15 МБ, VmSwap — 1 МБ. Что из этого верно?',
    'Какое поле /proc/meminfo показывает, сколько памяти можно выделить новым программам без вытеснения в своп?',
    'Зачем ядру нужно регулярное прерывание от таймера?',
    'Программа получила через mmap новую анонимную область с правом записи, без MAP_POPULATE, и впервые записывает в одну из её страниц. Что верно?',
    'Программа вызывает функции open() и fork(), а в выводе strace видны openat и clone. Почему?',
    'Что напечатает этот фрагмент?
```
ssize_t n = write(-1, "x", 1);
int saved = errno;
printf("%zd %s\n", n, strerror(saved));
```',
    'Когда в программе на C имеет смысл читать errno после вызова write()?',
    'Что не так в этом фрагменте?
```
write(fd, buf, len);
if (fdatasync(fd) == 0)
    printf("данные надёжно сохранены\n");
```',
    'Команда time показала: real 2.1s, user 0.4s, sys 1.6s. Что это значит?',
    'Представление tiny построено на представлении small, а оно — на таблице t. Почему в выводе EXPLAIN SELECT * FROM tiny нет ни tiny, ни small, а есть только таблица t?',
    'Допишите последнюю команду, чтобы посмотреть фактический план удаления, но не удалить строки:
```
BEGIN;
EXPLAIN ANALYZE DELETE FROM t WHERE id <= 10;
___;
```',
    'У таблицы t 637 страниц и 100 000 строк, параметры стоимости по умолчанию. Какой будет полная стоимость узла Seq Scan для этого запроса?
```
EXPLAIN SELECT * FROM t WHERE id > 10;
```',
    'Внутренний узел Nested Loop в EXPLAIN ANALYZE выглядит так. Сколько строк он вернул всего и сколько времени занял в сумме?
```
Index Scan using t_pkey on t (actual time=0.010..0.012 rows=1 loops=500)
```',
    'Чем команда ANALYZE t отличается от EXPLAIN ANALYZE SELECT * FROM t?',
    'После загрузки большой таблицы ANALYZE вручную не выполняли. При каком объёме изменений таблица станет кандидатом на автоматический ANALYZE при настройках по умолчанию?',
    'Что значит строка Heap Fetches: 999 в узле Index Only Scan?',
    'У таблиц t и r одинаковые данные и индексы по id, но в t строки лежат по порядку id, а в r — в случайном порядке. После загрузки обеих таблиц выполнен ANALYZE, настройки планировщика одинаковы. Для условия id < 5000 в t выбран Index Scan, а в r — Bitmap Heap Scan. Почему?',
    'Что верно для соединения Hash Join?',
    'Сортировка 100 000 строк по val в памяти (одинаковые данные и work_mem, в обоих планах Sort Method: quicksort) заняла 264 мс с COLLATE "C" и 2049 мс с COLLATE "ru_RU.utf8". Почему такая разница?'
)
AND NOT EXISTS (SELECT 1 FROM question_archive a WHERE a.question_id = q.id AND a.reason = 'Темы 18–20: исправлены странности (миграция 120)');

DO $check$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM question_archive WHERE reason = 'Темы 18–20: исправлены странности (миграция 120)';
    IF n <> 31 THEN
        RAISE EXCEPTION 'В архиве % копий вместо 31: прежние тексты вопросов не найдены', n;
    END IF;
END
$check$;

COMMIT;
