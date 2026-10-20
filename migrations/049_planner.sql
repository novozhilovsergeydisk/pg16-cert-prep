-- Раздел «20. Планировщик и EXPLAIN»: 30 вопросов с пояснениями к каждому варианту.
-- Источник: scripts/questions/049_planner.js
-- Повторный запуск безопасен; несовпадение ранее добавленного вопроса отменяет пакет.
-- https://www.postgresql.org/docs/16/rules-views.html
-- https://www.postgresql.org/docs/16/query-path.html
-- https://www.postgresql.org/docs/16/sql-explain.html
-- https://www.postgresql.org/docs/16/using-explain.html
-- https://www.postgresql.org/docs/16/runtime-config-query.html#RUNTIME-CONFIG-QUERY-CONSTANTS
-- https://www.postgresql.org/docs/16/using-explain.html#USING-EXPLAIN-ANALYZE
-- https://www.postgresql.org/docs/16/planner-stats.html
-- https://www.postgresql.org/docs/16/view-pg-stats.html
-- https://www.postgresql.org/docs/16/sql-analyze.html
-- https://www.postgresql.org/docs/16/routine-vacuuming.html#VACUUM-FOR-STATISTICS
-- https://www.postgresql.org/docs/16/indexes-bitmap-scans.html
-- https://www.postgresql.org/docs/16/indexes-index-only-scans.html
-- https://www.postgresql.org/docs/16/sql-createindex.html
-- https://www.postgresql.org/docs/16/ddl-system-columns.html
-- https://www.postgresql.org/docs/16/planner-optimizer.html
-- https://www.postgresql.org/docs/16/runtime-config-resource.html#GUC-HASH-MEM-MULTIPLIER
-- https://www.postgresql.org/docs/16/runtime-config-resource.html#GUC-WORK-MEM
-- https://www.postgresql.org/docs/16/collation.html
-- https://www.postgresql.org/docs/16/runtime-config-developer.html

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
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Представление tiny построено на представлении small, а оно — на таблице t. Почему в выводе EXPLAIN SELECT * FROM tiny нет ни tiny, ни small, а есть только таблица t?', '{"A":"Планировщик заранее кеширует результаты представлений","B":"Представления раскрываются на этапе переписывания, до планирования: планировщик получает запрос уже к таблице t","C":"Представления tiny и small материализованы","D":"EXPLAIN скрывает представления из соображений безопасности"}'::jsonb, 'B', 'Условия обоих представлений попадут в план как объединённое условие на t. Проверка: EXPLAIN SELECT * FROM tiny; дерево после переписывания: SET client_min_messages = log; SET debug_print_rewritten = on; SELECT * FROM tiny; RESET debug_print_rewritten; RESET client_min_messages; (представления создаются в главе 2 материала).', '{"A":"Обычное представление ничего не хранит: это сохранённый запрос.","B":"Планировщику нужно знать, какие таблицы стоят за представлением.","C":"Материализованное представление создаётся отдельной командой и в плане видно как таблица со своим именем.","D":"EXPLAIN ничего не скрывает: представлений в плане просто нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'На каком этапе обработки и с какой ошибкой завершится запрос, если таблицы nosuch нет?
```
SELECT * FROM nosuch;
```', '{"A":"На этапе выполнения, когда сервер не найдёт файл таблицы на диске","B":"На этапе разбора: syntax error","C":"На этапе разбора: relation \"nosuch\" does not exist — таблица не найдена в системном каталоге","D":"На этапе планирования: у таблицы нет статистики"}'::jsonb, 'C', 'Обе ошибки разбора — синтаксическая и «таблица не найдена» — возникают до планирования. Сравните: SELEC * FROM t; и SELECT * FROM nosuch;', '{"A":"До выполнения запрос не дойдёт: имя проверяется раньше.","B":"Синтаксическая ошибка была бы при опечатке в ключевом слове, например SELEC.","C":"Синтаксис верен, но при разборе сервер ищет имена в каталоге и не находит.","D":"Отсутствие статистики не ошибка: планировщик строит оценки по умолчанию."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Чем EXPLAIN отличается от EXPLAIN ANALYZE?', '{"A":"Разницы нет, ANALYZE только добавляет строку Planning Time","B":"EXPLAIN ANALYZE не выполняет INSERT, UPDATE и DELETE, а только оценивает их","C":"EXPLAIN ANALYZE дополнительно собирает статистику таблицы, как команда ANALYZE","D":"EXPLAIN только показывает план, EXPLAIN ANALYZE выполняет запрос и добавляет фактические время, строки и число выполнений узлов"}'::jsonb, 'D', 'Сравнение оценок с фактом — главный способ найти ошибку планировщика. Пример: EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM t WHERE id < 1000;', '{"A":"ANALYZE добавляет фактические цифры к каждому узлу.","B":"Выполняет: изменения действительно происходят.","C":"Слово одно, но статистику собирает отдельная команда ANALYZE.","D":"Поэтому EXPLAIN ANALYZE для изменения данных выполняют внутри транзакции с откатом."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Допишите последнюю команду, чтобы посмотреть фактический план удаления, но не удалить строки:
```
BEGIN;
EXPLAIN ANALYZE DELETE FROM t WHERE id <= 10;
___;
```', '{"A":"`SAVEPOINT s`","B":"`ROLLBACK`","C":"`END`","D":"`COMMIT`"}'::jsonb, 'B', 'EXPLAIN ANALYZE выполняет любой запрос по-настоящему. Проверка после отката: SELECT count(*) FROM t; — строк по-прежнему 100 000.', '{"A":"Точка сохранения ничего не отменяет и транзакцию не завершает.","B":"Откат отменяет удаление, которое EXPLAIN ANALYZE действительно выполнил.","C":"END — то же, что COMMIT: удаление сохранится.","D":"Фиксация сохранит удаление."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что означают числа в фрагменте плана cost=0.29..8.31?', '{"A":"Число прочитанных страниц индекса и таблицы","B":"Нижнюю и верхнюю границы погрешности оценки","C":"Время выполнения в миллисекундах: минимальное и максимальное","D":"Оценку стоимости в условных единицах: до получения первой строки и до получения всех строк"}'::jsonb, 'D', 'За единицу стоимости принято последовательное чтение одной страницы (seq_page_cost = 1). Посмотрите: EXPLAIN SELECT * FROM t WHERE id = 5; SHOW seq_page_cost;', '{"A":"Страницы показывает параметр BUFFERS.","B":"Погрешность планировщик не показывает.","C":"Время показывает только EXPLAIN ANALYZE, в поле actual time.","D":"Первое число — стоимость запуска, второе — полная стоимость."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'У таблицы t 637 страниц и 100 000 строк, параметры стоимости по умолчанию. Какой будет полная стоимость узла Seq Scan для этого запроса?
```
EXPLAIN SELECT * FROM t WHERE id > 10;
```', '{"A":"637","B":"1887: 637 страниц × 1 + 100 000 строк × 0.01 + 100 000 проверок условия × 0.0025","C":"1637","D":"3798"}'::jsonb, 'B', 'Стоимость — модель, а не измерение. Пересчитайте сами: SELECT relpages, reltuples FROM pg_class WHERE relname = ''t''; EXPLAIN SELECT * FROM t WHERE id > 10;', '{"A":"Учтены только страницы, без обработки строк и условия.","B":"seq_page_cost, cpu_tuple_cost и cpu_operator_cost по умолчанию.","C":"Так было бы без условия WHERE: проверка условия добавляет 250.","D":"Так было бы, если считать страницы по random_page_cost = 4, но полный просмотр читает таблицу подряд."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Внутренний узел Nested Loop в EXPLAIN ANALYZE выглядит так. Сколько строк он вернул всего и сколько времени занял в сумме?
```
Index Scan using t_pkey on t (actual time=0.010..0.012 rows=1 loops=500)
```', '{"A":"1 строку за 6 мс","B":"500 строк за 0.012 мс","C":"1 строку за 0.012 мс","D":"Около 500 строк и около 6 мс: время и строки указаны в среднем на одно выполнение"}'::jsonb, 'D', 'Большое loops у внутреннего узла соединения — первое, на что смотрят в медленном плане. Опыт с таблицей u из главы 9 материала: EXPLAIN (ANALYZE) SELECT * FROM t JOIN u ON u.t_id = t.id WHERE u.id < 100;', '{"A":"Строки, как и время, указаны в среднем на одно выполнение.","B":"Время тоже указано на одно выполнение, его нужно умножить на loops.","C":"Это цифры одного выполнения, а узел выполнялся 500 раз.","D":"0.012 мс × 500 ≈ 6 мс, около 1 строки × 500 ≈ 500 строк. Средние округлены, поэтому точное число по фрагменту не восстановить."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что верно для строк Index Cond и Filter в плане?', '{"A":"Filter бывает только у Seq Scan","B":"Index Cond — условие, по которому ведётся поиск в индексе","C":"Index Cond показывает индекс, который стоит создать","D":"Filter — условие, которое проверяется на уже прочитанных строках"}'::jsonb, 'BD', 'Если почти все прочитанные строки отбрасывает Filter, сервер читает лишнее. EXPLAIN ANALYZE показывает их число в строке Rows Removed by Filter: EXPLAIN (ANALYZE) SELECT * FROM t WHERE id > 10;', '{"A":"У Index Scan тоже бывает Filter: для условий, которые индекс не может проверить.","B":"Оно сужает, какие записи индекса читаются.","C":"Index Cond относится к уже используемому индексу.","D":"Строки, не прошедшие проверку, отбрасываются после чтения."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'В EXPLAIN ANALYZE у узла оценка rows=10, а фактически rows=95000. Что проверить в первую очередь?', '{"A":"Актуальность статистики: выполнить ANALYZE и посмотреть pg_stats","B":"Выключить enable_seqscan во всём сервере","C":"Перезапустить сервер","D":"Увеличить shared_buffers"}'::jsonb, 'A', 'Когда планировщик ждёт 10 строк, а получает 95 000, он может выбрать неподходящие способы доступа и соединения. Проверка: SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = ''t''; ANALYZE t;', '{"A":"Оценки строк берутся из статистики; устаревшая статистика — частая причина таких расхождений.","B":"Это лечит не причину, а симптом, и может ухудшить другие запросы.","C":"Перезапуск не обновляет статистику таблиц.","D":"Размер буферного кеша не влияет на оценку числа строк."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Допишите параметр, чтобы EXPLAIN ANALYZE показал, сколько страниц найдено в буферном кеше и сколько прочитано:
```
EXPLAIN (ANALYZE, ___) SELECT * FROM t WHERE id < 1000;
```', '{"A":"`TIMING`","B":"`VERBOSE`","C":"`COSTS`","D":"`BUFFERS`"}'::jsonb, 'D', 'shared hit — страница найдена в буферном кеше, read — прочитана из ОС или с диска. В PostgreSQL 16 BUFFERS указывают явно; с версии 18 он включается при ANALYZE по умолчанию. Проверка: EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM t WHERE id < 1000;', '{"A":"Управляет замером времени узлов при ANALYZE.","B":"Показывает выходные столбцы узлов, а не буферы.","C":"Управляет показом оценок стоимости, они включены по умолчанию.","D":"Добавляет строки Buffers: shared hit, read, dirtied, written."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что означает значение n_distinct = -1 для столбца в pg_stats?', '{"A":"В столбце одно-единственное значение","B":"При сборе статистики произошла ошибка","C":"Статистика по столбцу ещё не собрана","D":"По оценке последнего анализа все значения разные: число разных значений равно числу строк"}'::jsonb, 'D', 'Положительное значение — число разных значений, отрицательное — доля от числа строк. Так оценка масштабируется при росте таблицы, но после изменений данных её всё равно обновляет ANALYZE. Проверка: SELECT attname, n_distinct FROM pg_stats WHERE tablename = ''t'';', '{"A":"Тогда n_distinct было бы 1.","B":"Отрицательное значение — штатный способ записать долю.","C":"Тогда строки для столбца в pg_stats не было бы вовсе.","D":"Отрицательное число — доля от числа строк, -1 означает 100 %."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Чем команда ANALYZE t отличается от EXPLAIN ANALYZE SELECT * FROM t?', '{"A":"Ничем: обе собирают статистику","B":"ANALYZE t собирает статистику для планировщика, EXPLAIN ANALYZE выполняет запрос и показывает план с фактическими цифрами","C":"ANALYZE t выполняет запрос SELECT * FROM t и показывает время","D":"EXPLAIN ANALYZE обновляет статистику только той таблицы, к которой обращается запрос"}'::jsonb, 'B', 'ANALYZE строит выборку около 300 × default_statistics_target строк (по умолчанию около 30 000), просматривая для этого и больше. Подробности сбора: ANALYZE VERBOSE t. Когда статистика собиралась: SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = ''t'';', '{"A":"EXPLAIN ANALYZE статистику не собирает.","B":"Слово одно, назначение разное.","C":"ANALYZE читает выборку строк и записывает сводку в pg_statistic.","D":"Обновить статистику может только ANALYZE или автоочистка."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'После загрузки большой таблицы ANALYZE вручную не выполняли. Когда автоочистка соберёт статистику при настройках по умолчанию?', '{"A":"После каждой зафиксированной транзакции","B":"Раз в сутки, ночью","C":"Только при VACUUM FULL","D":"Когда число строк, изменённых с последнего анализа, превысит 50 + 10 % от оценки числа строк таблицы"}'::jsonb, 'D', 'Автоочистка может не успеть до первых запросов, поэтому после массовой загрузки ANALYZE выполняют вручную. Проверка: SELECT n_mod_since_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = ''t'';', '{"A":"Так было бы слишком дорого.","B":"Расписания у автоочистки нет: она реагирует на изменения.","C":"VACUUM FULL статистику для планировщика не собирает.","D":"Это autovacuum_analyze_threshold и autovacuum_analyze_scale_factor; число строк берётся из оценки reltuples. Анализ выполнится при ближайшем обходе автоочистки."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Для столбца id в pg_stats correlation = 1. Что это значит?', '{"A":"Значения id зависят от значений другого столбца","B":"По столбцу id есть индекс","C":"По статистике последнего анализа строки лежат в файле таблицы по возрастанию id","D":"Все значения id одинаковые"}'::jsonb, 'C', 'Значение -1 означает обратный порядок, около 0 — случайный. После изменений данных оценку обновляет ANALYZE. Сравните таблицу и её перемешанную копию: CREATE TABLE r AS SELECT * FROM t ORDER BY random(); ANALYZE r; SELECT tablename, correlation FROM pg_stats WHERE attname = ''id'';', '{"A":"Зависимость между столбцами описывает расширенная статистика CREATE STATISTICS.","B":"correlation считается для столбцов независимо от индексов.","C":"Соседние значения находятся на соседних страницах.","D":"Это показал бы n_distinct, а не correlation."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Как работает Bitmap Heap Scan?', '{"A":"Читает таблицу целиком и отбирает строки по битовой карте","B":"Сначала по индексу собирает карту нужных страниц, затем читает эти страницы в порядке файла, каждую один раз","C":"Берёт данные только из индекса, не обращаясь к таблице","D":"Для каждой записи индекса сразу читает строку из таблицы"}'::jsonb, 'B', 'Если карта не помещается в work_mem, часть страниц становится неточной, и условие перепроверяется на всех их строках (Heap Blocks: lossy). Посмотреть: SET enable_indexscan = off; EXPLAIN (ANALYZE) SELECT * FROM t WHERE id < 20000; RESET enable_indexscan;', '{"A":"Читаются только отмеченные страницы.","B":"Это два узла: Bitmap Index Scan и Bitmap Heap Scan.","C":"Так работает Index Only Scan.","D":"Так работает Index Scan."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Чем Index Scan отличается от Bitmap Heap Scan?', '{"A":"Bitmap Heap Scan может объединять несколько индексов узлами BitmapAnd и BitmapOr","B":"Index Scan выдаёт строки в порядке индекса и может обойтись без отдельной сортировки для ORDER BY","C":"Bitmap Heap Scan не обращается к таблице","D":"Index Scan читает каждую страницу таблицы не больше одного раза"}'::jsonb, 'AB', 'Index Scan выгоден для немногих строк или строк, лежащих по порядку индекса; Bitmap — для средней доли разбросанных строк. Объединение условий: EXPLAIN SELECT * FROM t WHERE id < 100 OR id > 99900;', '{"A":"Карты разных условий складываются до чтения таблицы.","B":"Bitmap Heap Scan выдаёт строки в порядке страниц.","C":"Обращается: читает отмеченные страницы.","D":"При разбросанных строках Index Scan может читать одну страницу многократно."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что значит строка Heap Fetches: 999 в узле Index Only Scan?', '{"A":"999 строк не найдено в индексе","B":"Сервер 999 раз обращался к таблице, потому что страницы не были отмечены в карте видимости как полностью видимые","C":"999 страниц прочитано с диска","D":"Индекс был прочитан 999 раз"}'::jsonb, 'B', 'Изменения строк снимают отметки в карте видимости, VACUUM ставит их снова. Опыт на копии v из главы 6 материала: UPDATE v SET val = val WHERE id < 1000; EXPLAIN (ANALYZE) SELECT id FROM v WHERE id < 1000; VACUUM v; и снова EXPLAIN.', '{"A":"Ненайденные строки не учитываются.","B":"Без отметки видимость строки можно проверить только в таблице.","C":"Обращения к страницам показывает BUFFERS; read — загрузки в буферный кеш, из кеша ОС или с диска.","D":"Это счётчик обращений к таблице, а не к индексу."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Почему по одному индексу нельзя понять, видна ли строка текущей транзакции?', '{"A":"Видимость определяется только по журналу предзаписи","B":"Индекс хранит только удалённые строки","C":"Номера транзакций xmin и xmax хранятся только в версиях строк таблицы, а в индексе их нет","D":"Индекс обновляется только при VACUUM"}'::jsonb, 'C', 'В индексе B-tree лежат значение и адрес строки (ctid). Посмотрите адреса: SELECT ctid, id FROM t WHERE id <= 3;', '{"A":"Журнал используется при восстановлении, а не для проверки видимости.","B":"Индекс хранит значения и адреса строк.","C":"Поэтому Index Scan проверяет видимость в таблице, а Index Only Scan — по карте видимости.","D":"Индекс обновляется сразу при вставке и изменении строк."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Допишите, чтобы запрос SELECT id, val FROM t WHERE id < 1000 мог выполняться способом Index Only Scan:
```
CREATE INDEX t_id_val ON t (id) ___ (val);
```', '{"A":"`INCLUDE`","B":"`USING`","C":"`WITH`","D":"`COVER`"}'::jsonb, 'A', 'Такой индекс называют покрывающим. Цена — он больше и медленнее обновляется. Проверка: EXPLAIN SELECT id, val FROM t WHERE id < 1000;', '{"A":"Добавляет в индекс столбец, который не участвует в поиске, но нужен запросу.","B":"USING указывает тип индекса, например btree.","C":"WITH задаёт параметры хранения индекса.","D":"Такого слова в команде нет."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'У таблиц t и r одинаковые данные и индексы по id, но в t строки лежат по порядку id, а в r — в случайном порядке. Для условия id < 5000 в t выбран Index Scan, а в r — Bitmap Heap Scan. Почему?', '{"A":"В r корреляция около 0: Index Scan прыгал бы по страницам, и планировщик оценил его дороже","B":"Для копий таблиц всегда выбирается Bitmap Heap Scan","C":"Индекс таблицы r повреждён","D":"У таблицы r нет статистики"}'::jsonb, 'A', 'Данные одни и те же, разница только в порядке строк в файле. Проверка: SELECT tablename, correlation FROM pg_stats WHERE tablename IN (''t'', ''r'') AND attname = ''id''; EXPLAIN SELECT * FROM r WHERE id < 5000; (таблица r — из главы 8 материала).', '{"A":"При низкой корреляции чтение страниц по индексу оценивается как произвольное, по random_page_cost.","B":"Способ доступа не зависит от того, как таблица создана.","C":"Индекс исправен, иначе его не использовал бы и Bitmap Heap Scan.","D":"Статистика есть; она как раз и показывает разницу в корреляции."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что такое ctid?', '{"A":"Первичный ключ таблицы","B":"Номер транзакции, создавшей строку","C":"Имя индекса первичного ключа","D":"Физический адрес версии строки: номер страницы и позиция на ней"}'::jsonb, 'D', 'Именно пары «значение — ctid» хранит индекс B-tree. После UPDATE у строки появляется новая версия с новым ctid. Проверка с откатом, чтобы не менять таблицу: BEGIN; SELECT ctid, id FROM t WHERE id = 1; UPDATE t SET val = val WHERE id = 1; SELECT ctid, id FROM t WHERE id = 1; ROLLBACK;', '{"A":"ctid есть у любой таблицы и меняется при изменении строки.","B":"Это xmin.","C":"Имя индекса первичного ключа обычно оканчивается на _pkey.","D":"Например, (0,5) — страница 0, позиция 5 в списке указателей страницы."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Когда планировщик обычно выбирает соединение Nested Loop?', '{"A":"Когда с одной стороны мало строк, а по ключу соединения в другой таблице есть индекс","B":"Только когда обе таблицы отсортированы по ключу соединения","C":"Для соединения двух больших таблиц по равенству","D":"Никогда, если есть условие равенства"}'::jsonb, 'A', 'Внутренний узел Nested Loop выполняется столько раз, сколько строк во внешнем. Сравните на таблице u из главы 9 материала: EXPLAIN SELECT * FROM t JOIN u ON u.t_id = t.id; и тот же запрос с WHERE u.id = 7.', '{"A":"Для каждой внешней строки пара находится быстрым поиском по индексу.","B":"Упорядоченность нужна Merge Join.","C":"Для больших наборов обычно выгоднее Hash Join.","D":"Nested Loop применяется и для равенства, а если соединение задано только неравенством, он единственный вариант."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что верно для соединения Hash Join?', '{"A":"Для поиска пар нужно хотя бы одно условие равенства; дополнительные условия проверяются отдельно","B":"Требует, чтобы входные данные были отсортированы","C":"Работает только при наличии индексов на обеих таблицах","D":"Строит хеш-таблицу по одному набору и ищет пары, просматривая второй","E":"Если хеш-таблица не помещается в память, данные делятся на порции, и при ANALYZE видно Batches больше 1"}'::jsonb, 'ADE', 'Hash Join обычно выбирают для соединения больших наборов. Проверка на таблице u из главы 9 материала: EXPLAIN (ANALYZE) SELECT * FROM t JOIN u ON u.t_id = t.id; — в узле Hash смотрите Buckets, Batches и Memory Usage.', '{"A":"Хеш находит равные ключи; остальные условия соединения проверяет Join Filter.","B":"Сортировка нужна Merge Join.","C":"Hash Join обходится без индексов.","D":"В плане хеш-таблицу строит узел Hash.","E":"Лимит памяти — work_mem × hash_mem_multiplier."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Таблица o содержит 5000 строк, таблица big — 100 000 строк, индекса по big.id нет. Что показывает этот фрагмент плана и что с ним делать?
```
Nested Loop (cost=... rows=1) (actual ... rows=5000 loops=1)
  Join Filter: (big.id = o.big_id)
  Rows Removed by Join Filter: 499995000
  -> Seq Scan on o (cost=... rows=1) (actual ... rows=5000 loops=1)
  -> Seq Scan on big (cost=... rows=100000) (actual ... rows=100000 loops=5000)
```', '{"A":"Планировщик ждал из o одну строку, а их 5000, и big прочитана целиком 5000 раз; нужно обновить статистику o и создать индекс по big.id","B":"План оптимален: последовательный просмотр всегда быстрее индекса","C":"Нужно увеличить shared_buffers","D":"Таблица big прочитана один раз, а 5000 — число найденных строк"}'::jsonb, 'A', 'Расхождение оценки и факта у внешнего узла — частая причина плохих соединений. Rows Removed by Join Filter = 5000 × 100 000 − 5000 = 499 995 000. Что сделать на своей схеме: ANALYZE o; CREATE INDEX ON big (id); и снова EXPLAIN ANALYZE.', '{"A":"Ошибка оценки привела к выбору вложенного цикла: с верной оценкой планировщик выбрал бы, например, Hash Join, а с индексом пары находились бы быстрым поиском.","B":"Фильтр соединения отбросил почти пять миллиардов пар: работы проделано в тысячи раз больше нужного.","C":"Буферный кеш не уменьшит число полных просмотров и не исправит оценку.","D":"loops=5000 значит, что узел выполнялся 5000 раз."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Что означает в EXPLAIN ANALYZE строка Sort Method: external merge  Disk: 5104kB?', '{"A":"Данные не поместились в work_mem и сортировались порциями через временные файлы","B":"Результат сортировки записан в таблицу на диске","C":"Сортировка использовала индекс, хранящийся на диске","D":"Серверу не хватило shared_buffers"}'::jsonb, 'A', 'Если данные поместились, будет quicksort  Memory: ...kB. Сравните: SET work_mem = ''64kB''; EXPLAIN (ANALYZE) SELECT * FROM t ORDER BY val; затем с work_mem = ''64MB''.', '{"A":"Порции записываются на диск и затем сливаются.","B":"Временные файлы сортировки удаляются после запроса.","C":"Индекс может быть в плане ниже узла Sort; сортировка не нужна, только если индекс уже даёт нужный порядок.","D":"Сортировка ограничена work_mem, а не буферным кешем."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'В каком из этих запросов к таблице t в плане обычно появится Sort Method: top-N heapsort?', '{"A":"SELECT * FROM t ORDER BY val LIMIT 10;","B":"SELECT * FROM t ORDER BY val;","C":"SELECT val, count(*) FROM t GROUP BY val;","D":"SELECT * FROM t ORDER BY id LIMIT 10;"}'::jsonb, 'A', 'top-N heapsort почти не расходует память, даже если строк много. Проверка: EXPLAIN (ANALYZE) SELECT * FROM t ORDER BY val LIMIT 10;', '{"A":"Индекса по val нет, а нужно только 10 строк: сервер держит в памяти 10 лучших.","B":"Без LIMIT сортируются все строки: quicksort или external merge.","C":"Группировка обычно выполняется через хеш-таблицу, без top-N.","D":"Порядок по id даёт индекс t_pkey, сортировка не нужна."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Сортировка 100 000 строк по val в памяти заняла 264 мс с COLLATE "C" и 2049 мс с COLLATE "ru_RU.utf8". Почему такая разница?', '{"A":"С правилами ru_RU.utf8 строки сортируются на диске","B":"Правилам ru_RU.utf8 нужно больше work_mem","C":"Сравнение по правилам языка многоуровневое и намного дороже побайтового сравнения в C","D":"COLLATE \"C\" использует индекс"}'::jsonb, 'C', 'Для столбцов, где не нужен алфавитный порядок языка, COLLATE "C" даёт заметный выигрыш. Какие правила есть на сервере: SELECT collname FROM pg_collation WHERE collname ILIKE ''ru%'';', '{"A":"В обоих случаях сортировка шла в памяти: quicksort.","B":"Объём памяти одинаковый: Memory у обоих планов совпадает.","C":"При сотнях тысяч сравнений разница в цене одного сравнения становится главной.","D":"Индекса по val нет, в обоих случаях есть узел Sort."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'У сортировки с COLLATE "C" и с COLLATE "ru_RU.utf8" одинаковая оценка cost, хотя вторая выполняется почти в восемь раз дольше. Почему?', '{"A":"Статистика таблицы устарела","B":"EXPLAIN не учитывает стоимость сортировки","C":"Модель стоимости считает каждое сравнение одинаково дешёвым и не знает реальной цены правил сравнения","D":"Стоимость учитывает только чтение с диска"}'::jsonb, 'C', 'Стоимость — модель для выбора между планами, а не прогноз времени. Сравните оценку и факт: EXPLAIN (ANALYZE) SELECT * FROM t ORDER BY val COLLATE "C"; и с ru_RU.utf8.', '{"A":"Число строк оценено верно; расходится время, а не строки.","B":"Учитывает: у узла Sort своя стоимость.","C":"Поэтому такие различия находят только замером.","D":"В стоимость входят и вычисления, например cpu_operator_cost."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Строки таблицы вставлены по порядку id, значения val имеют вид «строка 1», «строка 2» и так далее. Сортировка по val с COLLATE "ru_RU.utf8" через диск (external merge) оказалась в два раза быстрее, чем в памяти, а на перемешанной копии таблицы — медленнее. Почему?', '{"A":"При внешней сортировке сравнение строк идёт по правилам C","B":"Внешняя сортировка использовала индекс по id","C":"Порции из подряд идущих строк в большинстве были уже упорядочены, а быстрая сортировка PostgreSQL обрабатывает упорядоченные данные одним проходом","D":"Временные файлы на диске работают быстрее оперативной памяти"}'::jsonb, 'C', 'Время сортировки зависит от числа и цены сравнений, а их число — от исходного порядка данных. Подробности этапов: SET work_mem = ''64kB''; SET client_min_messages = log; SET trace_sort = on; EXPLAIN (ANALYZE) SELECT * FROM t ORDER BY val COLLATE "ru_RU.utf8"; RESET ALL;', '{"A":"Правило сравнения не зависит от способа сортировки.","B":"Индекс по id не помогает сортировать по val.","C":"Дорогих сравнений понадобилось намного меньше; на перемешанных данных это преимущество исчезло.","D":"Тогда внешняя сортировка выигрывала бы и на перемешанных данных."}'::jsonb
UNION ALL
SELECT (SELECT id FROM categories WHERE left(name, 3) = '20.'), 'Допишите параметр, чтобы увидеть подробности сортировки: число порций, проходы слияния и время этапов:
```
SET client_min_messages = log;
SET ___ = on;
EXPLAIN (ANALYZE) SELECT * FROM t ORDER BY val;
```', '{"A":"`track_io_timing`","B":"`log_temp_files`","C":"`trace_sort`","D":"`debug_print_plan`"}'::jsonb, 'C', 'В выводе видно, сколько было порций (run) и проходов слияния. Время в сообщениях накопительное, от начала сортировки: длительность этапа — разность соседних отметок. После опыта: RESET trace_sort; RESET client_min_messages;', '{"A":"Включает замер времени ввода-вывода для статистики и BUFFERS.","B":"Этот параметр журналирует временные файлы и задаётся размером в килобайтах, а не on.","C":"Служебный параметр: выводит ход сортировки сообщениями уровня LOG.","D":"Выводит дерево плана, а не ход сортировки."}'::jsonb;

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
    IF (SELECT count(*) FROM questions q JOIN question_seed n ON q.question_text = n.question_text) <> 30 THEN
        RAISE EXCEPTION 'Неверное число вопросов после добавления';
    END IF;
END
$check$;

COMMIT;
