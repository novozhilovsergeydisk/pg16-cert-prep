--------------------------------------------------------------------------------
-- РАЗДЕЛ 1: ИССЛЕДОВАНИЕ MVCC И ФИЗИЧЕСКОЙ СТРУКТУРЫ СТРАНИЦ
-- Требуется для понимания работы xmin, xmax, t_ctid и мёртвых строк
--------------------------------------------------------------------------------
-- Учебная шпаргалка: выполнять в отдельной базе для упражнений, не в рабочей БД.
-- Требуются права на установку pageinspect и pg_buffercache.
-- Скрипт удаляет таблицу t и создаёт shared_t/local_t; разделы выполнять по порядку.
-- 1.1 Включение расширения для просмотра "сырых" страниц памяти
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- 1.2 Создание тестовой таблицы и моделирование разных состояний транзакций
DROP TABLE IF EXISTS t;
CREATE TABLE t (id int);

-- Вариант A (id=1): Вставку зафиксировали (COMMITTED)
BEGIN; INSERT INTO t (id) VALUES (1); COMMIT;
-- Вариант B (id=2): Вставку отменили (ROLLBACK) - мёртвая строка
BEGIN; INSERT INTO t (id) VALUES (2); ROLLBACK;
-- Вариант C (id=3): Вставили и удалили (Обе COMMITTED) - мёртвая строка
BEGIN; INSERT INTO t (id) VALUES (3); COMMIT;
BEGIN; DELETE FROM t WHERE id = 3; COMMIT;
-- Вариант D (id=4): Вставили, но удаление отменили (DELETE = ROLLBACK)
BEGIN; INSERT INTO t (id) VALUES (4); COMMIT;
BEGIN; DELETE FROM t WHERE id = 4; ROLLBACK;

-- 1.3 Логическое чтение (как видит данные уровень Read Committed)
-- База "на лету" проверяет статус транзакций в pg_xact и скрывает мусор
SELECT xmin, xmax, id FROM t;

-- 1.4 Физическое чтение (как данные реально лежат в нулевом блоке на диске)
-- Здесь видны отменённые вставки и удалённые строки
SELECT
    lp AS "номер_указателя",
    t_xmin AS "создатель_xmin",
    t_xmax AS "удалитель_xmax",
    t_ctid AS "ссылка_ctid",
    t_data AS "сырые_данные_id"
FROM heap_page_items(get_raw_page('t', 0));


--------------------------------------------------------------------------------
-- РАЗДЕЛ 2: БУФЕРНЫЙ КЕШ, ПАМЯТЬ И БЛОКИРОВКИ
-- Демонстрация разницы между Shared Buffers и Local Buffers
--------------------------------------------------------------------------------

-- 2.1 Подготовка таблиц (обычная и временная)
CREATE TABLE shared_t AS SELECT generate_series(1, 10000) AS id;
CREATE TEMP TABLE local_t AS SELECT generate_series(1, 10000) AS id;

-- 2.2 Сравнение планов запроса (обратите внимание на тип hit в Buffers)
-- shared hit требует LWLocks (координации), local hit работает без них
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT count(*) FROM shared_t;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT count(*) FROM local_t;

-- 2.3 Включение расширения для инспекции оперативной памяти
CREATE EXTENSION IF NOT EXISTS pg_buffercache;

-- 2.4 Просмотр состояния страниц конкретной таблицы в Shared Buffers
SELECT
    c.relname,
    b.bufferid,
    b.isdirty,           -- t = изменён, f = совпадает с диском
    b.pinning_backends,  -- Счётчик закреплений (Pin) текущими процессами
    b.usagecount         -- Популярность (0-5) для алгоритма вытеснения Clock Sweep
FROM pg_buffercache b
JOIN pg_class c ON b.relfilenode = c.relfilenode
WHERE c.oid = 'shared_t'::regclass
  AND b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND b.reltablespace = COALESCE(NULLIF(c.reltablespace, 0),
      (SELECT dattablespace FROM pg_database WHERE datname = current_database()))
LIMIT 5;

-- 2.5 Мониторинг очередей за легковесными блокировками (LWLocks)
-- Запрос вернёт данные только при высокой конкуренции (ожидания buffer_mapping/content)
SELECT pid, query, wait_event_type, wait_event
FROM pg_stat_activity
WHERE wait_event_type = 'LWLock';

-- 2.6 Просмотр тяжелых (логических) блокировок текущих транзакций
-- Здесь отображаются блокировки таблиц (relation) и виртуальных транзакций (virtualxid)
SELECT locktype, relation::regclass, mode, granted, pid
FROM pg_locks
WHERE pid = pg_backend_pid();


--------------------------------------------------------------------------------
-- РАЗДЕЛ 3: СИСТЕМНЫЕ КАТАЛОГИ (PG_CLASS) И СТАТИСТИКА
-- Поиск объектов и проверка наличия актуальной статистики для планировщика
--------------------------------------------------------------------------------

-- 3.1 Поиск таблиц, индексов и их схем
-- relkind: r = таблица, i = индекс, t = TOAST-таблица
SELECT
    relname AS "Имя_объекта",
    relkind AS "Тип",
    relnamespace::regnamespace AS "Схема"
FROM pg_class
WHERE relname IN ('shared_t', 'local_t', 't', 'ops_pkey');

-- 3.2 Проверка наличия статистики (reltuples = -1 означает, что статистика не собрана)
SELECT
    relname,
    reltuples AS "оценка_кол_ва_строк",
    relpages AS "физический_размер_в_страницах"
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace;

-- 3.3 Ручной сбор статистики (после этого reltuples обновится)
-- ANALYZE t;
