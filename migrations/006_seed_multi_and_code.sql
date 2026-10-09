-- Вопросы двух новых типов по всем темам DBA1: по 3 «выберите несколько» и 3 «дополните код».
-- Формулировки свои. Миграция не идемпотентна: повторный запуск задублирует вопросы.

BEGIN;

INSERT INTO questions (category_id, question_text, options, correct_answer, explanation) VALUES
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Какие утилиты относятся к пакету PostgreSQL для Ubuntu, а не к стандартной поставке?',
     '{"A":"`pg_ctlcluster`","B":"`pg_createcluster`","C":"`pg_ctl`","D":"`initdb`"}'::jsonb,
     'AB',
     'pg_ctlcluster, pg_createcluster, pg_dropcluster и pg_lsclusters — обёртки, специфичные для Ubuntu и Debian.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Что обязательно нужно для сборки PostgreSQL из исходных кодов традиционным способом?',
     '{"A":"Язык Perl","B":"Компилятор языка C","C":"GNU make","D":"Библиотека readline"}'::jsonb,
     'BC',
     'Readline, zlib и другие библиотеки можно отключить, Perl нужен только для PL/Perl и сборки из git.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Что верно для утилиты initdb?',
     '{"A":"Может работать от имени root","B":"Запускает сервер после инициализации","C":"Создаёт файлы конфигурации в каталоге кластера","D":"Ключ -U задаёт имя суперпользователя СУБД"}'::jsonb,
     'CD',
     'Сервер после initdb запускают отдельно, например pg_ctl start. Каталог кластера не может принадлежать root.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Допишите команду, чтобы инициализировать кластер с подсчётом контрольных сумм:
```
initdb -U postgres ___ -D /home/student/pgsql16/data
```',
     '{"A":"`-k`","B":"`-m`","C":"`-l`","D":"`-c`"}'::jsonb,
     'A',
     'Ключ -k (--data-checksums) включает контрольные суммы страниц данных.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Допишите команду, чтобы запустить сервер и писать журнал сообщений в файл:
```
pg_ctl start ___ /home/student/logfile
```',
     '{"A":"`-l`","B":"`-D`","C":"`-o`","D":"`-w`"}'::jsonb,
     'A',
     'Ключ -l задаёт файл журнала, -D — каталог кластера, -o передаёт параметры серверу, -w ждёт завершения операции.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '01.'),
     'Допишите команду, чтобы в Ubuntu остановить кластер main версии 16:
```
sudo pg_ctlcluster ___ stop
```',
     '{"A":"`main`","B":"`main 16`","C":"`16 main`","D":"`-D /var/lib/postgresql/16/main`"}'::jsonb,
     'C',
     'pg_ctlcluster принимает номер версии, имя кластера и команду именно в таком порядке.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Какими способами можно выполнить SQL-команды из файла?',
     '{"A":"`psql -f файл` из командной строки","B":"`\\i файл` внутри psql","C":"`\\o файл` внутри psql","D":"`psql -o файл` из командной строки"}'::jsonb,
     'AB',
     'Команда \o и ключ -o, наоборот, направляют вывод результатов в файл. Ещё один способ — psql < файл.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Чем можно завершить запрос в psql, чтобы отправить его на выполнение?',
     '{"A":"`\\g`","B":"`;`","C":"`\\gx`","D":"`\\o`"}'::jsonb,
     'ABC',
     '\gx дополнительно выводит результат в расширенном формате, \o перенаправляет вывод и запрос не отправляет.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Что верно для переменных psql?',
     '{"A":"`\\unset` удаляет переменную окружения ОС","B":"Значение подставляется через двоеточие: `:имя`","C":"Переменная psql автоматически становится параметром сервера","D":"`\\set` без параметров выводит все переменные"}'::jsonb,
     'BD',
     'Переменные psql живут только в клиенте. Переменные окружения задаются отдельно, например командой \setenv.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Допишите команду, чтобы сохранить результат запроса в переменную psql curr_time:
```
SELECT now() AS curr_time ___
```',
     '{"A":"`\\set`","B":"`\\gset`","C":"`\\gx`","D":"`\\gexec`"}'::jsonb,
     'B',
     '\gset записывает столбцы единственной строки результата в одноимённые переменные psql.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Допишите настройку, чтобы приглашение имело вид пользователь@база=#:
```
\set PROMPT1 ''___%/%R%x%# ''
```',
     '{"A":"`%u@`","B":"`%d@`","C":"`%n@`","D":"`%/@`"}'::jsonb,
     'C',
     '%n в приглашении — имя пользователя текущего сеанса, %/ — имя базы данных.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '02.'),
     'Допишите строку в ~/.psqlrc, чтобы psql выводил длительность выполнения команд:
```
\timing ___
```',
     '{"A":"`on`","B":"`ms`","C":"`all`","D":"`enable`"}'::jsonb,
     'A',
     'Команда \timing on включает вывод времени выполнения; в .psqlrc настройка действует для каждого запуска.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Какими способами можно перечитать файлы конфигурации?',
     '{"A":"`ALTER SYSTEM RELOAD;`","B":"`RESET ALL;`","C":"`SELECT pg_reload_conf();`","D":"`pg_ctl reload`"}'::jsonb,
     'CD',
     'В Ubuntu есть ещё pg_ctlcluster 16 main reload. RESET ALL только сбрасывает параметры сеанса.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Какими способами можно узнать текущее значение параметра work_mem в сеансе?',
     '{"A":"`\\set work_mem`","B":"`SHOW work_mem;`","C":"Запрос к `pg_file_settings`","D":"`SELECT current_setting(''work_mem'');`"}'::jsonb,
     'BD',
     'pg_file_settings показывает содержимое файлов конфигурации, а \set задаёт переменную psql. Действующие значения есть в pg_settings.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Что верно для файла postgresql.auto.conf?',
     '{"A":"Изменения в нём применяются без перечитывания конфигурации","B":"Изменяется командой ALTER SYSTEM","C":"Считывается после postgresql.conf","D":"Его рекомендуется редактировать вручную"}'::jsonb,
     'BC',
     'Файл управляется только через ALTER SYSTEM; после изменений конфигурацию нужно перечитать, как и для postgresql.conf.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Допишите значение, чтобы команда выполнилась без ошибки:
```
ALTER SYSTEM SET work_mem TO ___;
```',
     '{"A":"`''16mb''`","B":"`''16 Mb''`","C":"`''16MB''`","D":"`16 MB`"}'::jsonb,
     'C',
     'Единицы измерения чувствительны к регистру (B, kB, MB, GB, TB), а значение с единицей указывается в кавычках.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Допишите команду, чтобы значение действовало только до конца текущей транзакции:
```
BEGIN;
SET ___ work_mem TO ''64MB'';
```',
     '{"A":"`TRANSACTION`","B":"`SESSION`","C":"`LOCAL`","D":"`TEMP`"}'::jsonb,
     'C',
     'SET LOCAL действует до конца транзакции, SET SESSION (или просто SET) — до конца сеанса.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '03.'),
     'Допишите вызов, чтобы значение действовало только до конца транзакции:
```
SELECT set_config(''work_mem'', ''32MB'', ___);
```',
     '{"A":"`''local''`","B":"`1`","C":"`true`","D":"`false`"}'::jsonb,
     'C',
     'Третий параметр set_config типа boolean: true — до конца транзакции, false — до конца сеанса.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Какие из перечисленного — этапы обработки запроса на сервере?',
     '{"A":"Вытеснение","B":"Контрольная точка","C":"Переписывание","D":"Планирование"}'::jsonb,
     'CD',
     'Запрос проходит разбор, переписывание, планирование и выполнение. Вытеснение и контрольная точка относятся к буферному кешу.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Какие свойства транзакций в первую очередь обеспечивает многоверсионность?',
     '{"A":"Изоляция","B":"Масштабируемость","C":"Долговечность","D":"Атомарность"}'::jsonb,
     'AD',
     'Многоверсионность обеспечивает атомарность, согласованность и изоляцию; долговечность — журнал предзаписи.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Что хранится в локальной памяти обслуживающего процесса?',
     '{"A":"Кеш системного каталога","B":"Буферный кеш","C":"Буферы статусов транзакций","D":"Состояние открытых курсоров"}'::jsonb,
     'AD',
     'Буферный кеш и буферы clog находятся в общей памяти, доступной всем процессам.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Допишите команду, чтобы выполнить подготовленный оператор:
```
PREPARE q(int) AS SELECT * FROM t WHERE id = $1;
___ q(42);
```',
     '{"A":"`CALL`","B":"`EXECUTE`","C":"`RUN`","D":"`PERFORM`"}'::jsonb,
     'B',
     'Подготовленный оператор выполняют командой EXECUTE с указанием значений параметров. CALL вызывает процедуру.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Допишите команду, чтобы получить из курсора следующие 10 строк:
```
BEGIN;
DECLARE c CURSOR FOR SELECT * FROM t;
___ 10 FROM c;
```',
     '{"A":"`MOVE`","B":"`GET`","C":"`READ`","D":"`FETCH`"}'::jsonb,
     'D',
     'FETCH возвращает строки, MOVE только сдвигает позицию курсора без вывода.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '04.'),
     'Допишите команду, чтобы отменить все изменения транзакции:
```
BEGIN;
UPDATE accounts SET amount = amount - 100 WHERE id = 1;
___;
```',
     '{"A":"`END`","B":"`CANCEL`","C":"`ROLLBACK`","D":"`COMMIT`"}'::jsonb,
     'C',
     'END — синоним COMMIT, он фиксирует изменения.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'На каких уровнях изоляции транзакция может завершиться ошибкой сериализации?',
     '{"A":"Read Committed","B":"Serializable","C":"Repeatable Read","D":"Read Uncommitted"}'::jsonb,
     'BC',
     'Приложение должно уметь повторять такие транзакции.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'Что верно для уровня изоляции Read Committed?',
     '{"A":"Снимок строится один раз на всю транзакцию","B":"Снимок строится в начале каждого оператора","C":"Видны незафиксированные изменения других транзакций","D":"Два одинаковых запроса в одной транзакции могут вернуть разные данные"}'::jsonb,
     'BD',
     'Один снимок на транзакцию используется на уровне Repeatable Read. Грязное чтение PostgreSQL не допускает.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'Что верно для блокировок в PostgreSQL?',
     '{"A":"Изменение строки блокирует её чтение","B":"Блокировки снимаются автоматически при завершении транзакции","C":"Блокировки строк снимаются сразу после выполнения оператора","D":"Чтение не блокирует ни читающие, ни пишущие транзакции"}'::jsonb,
     'BD',
     'Транзакция ждёт, только если меняет строку, уже изменённую другой незафиксированной транзакцией.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'Допишите команду, чтобы все запросы транзакции работали с одним снимком данных:
```
BEGIN ISOLATION LEVEL ___;
```',
     '{"A":"`READ COMMITTED`","B":"`REPEATABLE READ`","C":"`CONSISTENT`","D":"`READ UNCOMMITTED`"}'::jsonb,
     'B',
     'На уровне Repeatable Read снимок строится при первом операторе транзакции. Read Uncommitted работает как Read Committed.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'Допишите команду, чтобы получить полную изоляцию, как при последовательном выполнении транзакций:
```
BEGIN;
SET TRANSACTION ISOLATION LEVEL ___;
```',
     '{"A":"`READ COMMITTED`","B":"`EXCLUSIVE`","C":"`SERIALIZABLE`","D":"`REPEATABLE READ`"}'::jsonb,
     'C',
     'Serializable гарантирует полную изоляцию, но часть транзакций будет прерываться ошибкой сериализации.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '05.'),
     'Допишите запрос, чтобы до конца транзакции другие не могли изменить выбранную строку:
```
SELECT * FROM accounts WHERE id = 1 FOR ___;
```',
     '{"A":"`UPDATE`","B":"`LOCK`","C":"`CHANGE`","D":"`WRITE`"}'::jsonb,
     'A',
     'SELECT ... FOR UPDATE блокирует выбранные строки для изменения другими транзакциями.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Какие задачи выполняет процесс автоочистки?',
     '{"A":"Удаление мёртвых версий строк","B":"Сбор статистики для планировщика","C":"Возврат свободного места операционной системе","D":"Перестроение индексов"}'::jsonb,
     'AB',
     'Автоочистка также обновляет карты видимости и свободного пространства и выполняет заморозку.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Что может привести к разрастанию таблиц и индексов?',
     '{"A":"Включённые контрольные суммы","B":"Долгие транзакции","C":"Массовое изменение данных","D":"Частые контрольные точки"}'::jsonb,
     'BC',
     'Также разрастание вызывает неправильная настройка автоочистки.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Что верно для команды VACUUM FULL?',
     '{"A":"Уменьшает физический размер файлов таблицы","B":"Требует исключительной блокировки таблицы","C":"Работает параллельно с изменениями таблицы","D":"Только собирает статистику"}'::jsonb,
     'AB',
     'Без долгой блокировки таблицу можно перестроить сторонним расширением pg_repack.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Допишите команду, чтобы одной командой выполнить очистку и сбор статистики:
```
VACUUM ___ accounts;
```',
     '{"A":"`ANALYZE`","B":"`FREEZE`","C":"`FULL`","D":"`STATS`"}'::jsonb,
     'A',
     'VACUUM ANALYZE выполняет и очистку, и анализ.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Допишите команду ОС, чтобы только собрать статистику без очистки:
```
vacuumdb ___ appdb
```',
     '{"A":"`--analyze`","B":"`--full`","C":"`--stats`","D":"`--analyze-only`"}'::jsonb,
     'D',
     '--analyze выполняет и очистку, и анализ, а --analyze-only — только анализ.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '06.'),
     'Допишите команду, чтобы перестроить индекс без блокировки изменений таблицы:
```
REINDEX INDEX ___ accounts_pkey;
```',
     '{"A":"`ONLINE`","B":"`NOWAIT`","C":"`QUICK`","D":"`CONCURRENTLY`"}'::jsonb,
     'D',
     'REINDEX CONCURRENTLY не выполняется внутри транзакции и не работает для системных индексов.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Что защищает журнал предзаписи?',
     '{"A":"Статусы транзакций (clog)","B":"Нежурналируемые таблицы","C":"Временные таблицы","D":"Страницы таблиц и индексов"}'::jsonb,
     'AD',
     'Временные и нежурналируемые таблицы в журнал не попадают и после сбоя не восстанавливаются.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Какие процессы записывают грязные буферы из буферного кеша на диск?',
     '{"A":"bgwriter","B":"autovacuum launcher","C":"checkpointer","D":"walwriter"}'::jsonb,
     'AC',
     'walwriter пишет журнал. Если вытесняемый буфер грязный, его может записать и обслуживающий процесс.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Что верно для контрольной точки?',
     '{"A":"Выполняется только при остановке сервера","B":"Сбрасывает на диск все грязные буферы, включая буферы clog","C":"Удаляет мёртвые версии строк","D":"Запись буферов растягивается во времени"}'::jsonb,
     'BD',
     'Контрольные точки выполняются периодически и ограничивают объём журнала для восстановления.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Допишите команду, чтобы узнать текущий уровень журнала:
```
SHOW ___;
```',
     '{"A":"`wal_level`","B":"`wal_mode`","C":"`log_level`","D":"`journal_level`"}'::jsonb,
     'A',
     'Уровень журнала задаёт параметр wal_level: minimal, replica (по умолчанию) или logical.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Допишите команду, чтобы остановить сервер без контрольной точки, как при сбое:
```
pg_ctl stop -m ___
```',
     '{"A":"`immediate`","B":"`abort`","C":"`fast`","D":"`smart`"}'::jsonb,
     'A',
     'В режиме fast перед выключением выполняется контрольная точка, а после immediate сервер при запуске восстанавливается по журналу.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '07.'),
     'Допишите команду, чтобы выполнить контрольную точку вручную:
```
___;
```',
     '{"A":"`VACUUM`","B":"`SYNC`","C":"`CHECKPOINT`","D":"`FLUSH`"}'::jsonb,
     'C',
     'CHECKPOINT может выполнить суперпользователь или роль с правами pg_checkpoint.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Какие базы данных создаются при инициализации кластера?',
     '{"A":"template0","B":"postgres","C":"template1","D":"main"}'::jsonb,
     'ABC',
     'main — это имя кластера в пакете Ubuntu, а не базы данных.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Что верно для пути поиска search_path?',
     '{"A":"pg_catalog не просматривается, если её нет в пути","B":"Несуществующие схемы из пути исключаются","C":"Новые объекты создаются в последней схеме пути","D":"Схемы перебираются слева направо"}'::jsonb,
     'BD',
     'Новый объект попадает в первую явно указанную схему, а pg_catalog неявно проверяется первой.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Что верно для временных таблиц?',
     '{"A":"Не журналируются","B":"Восстанавливаются после сбоя","C":"Видны только создавшему их сеансу","D":"Хранятся в общем буферном кеше"}'::jsonb,
     'AC',
     'Страницы временных таблиц обрабатываются в локальной памяти обслуживающего процесса.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Допишите команду, чтобы создать базу для восстановления из копии pg_dump:
```
CREATE DATABASE appdb TEMPLATE ___;
```',
     '{"A":"`default`","B":"`postgres`","C":"`template0`","D":"`template1`"}'::jsonb,
     'C',
     'Изменения template1 тоже попадают в копию pg_dump, поэтому восстанавливают в базу из template0.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Допишите команду, чтобы сначала просматривалась схема app, затем public:
```
SET search_path = ___;
```',
     '{"A":"`public, app`","B":"`''app.public''`","C":"`app.public`","D":"`app, public`"}'::jsonb,
     'D',
     'Схемы в search_path перечисляются через запятую в порядке просмотра.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '08.'),
     'Допишите команду, чтобы значение действовало во всех новых сеансах базы appdb:
```
ALTER DATABASE appdb ___ temp_buffers = ''32MB'';
```',
     '{"A":"`ALTER`","B":"`CONFIG`","C":"`PARAMETER`","D":"`SET`"}'::jsonb,
     'D',
     'ALTER DATABASE ... SET задаёт значение параметра для новых сеансов в этой базе.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Какие таблицы системного каталога общие для всего кластера?',
     '{"A":"`pg_class`","B":"`pg_database`","C":"`pg_proc`","D":"`pg_authid`"}'::jsonb,
     'BD',
     'Базы данных, роли и табличные пространства описываются общими таблицами в pg_global; pg_class и pg_proc есть в каждой базе.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Что верно для схемы information_schema?',
     '{"A":"Определена стандартом SQL","B":"Доступна только суперпользователю","C":"Стабильнее и переносимее, чем pg_catalog","D":"Отражает все особенности PostgreSQL"}'::jsonb,
     'AC',
     'Специфику PostgreSQL отражает только pg_catalog.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Что верно для типа данных oid?',
     '{"A":"Хранит имя объекта в текстовом виде","B":"Используется как первичный ключ большинства таблиц каталога","C":"Всегда 64-битный","D":"Это 32-битное целое число"}'::jsonb,
     'BD',
     'Для преобразования имён в oid и обратно служат типы reg*, например regclass.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Допишите запрос, чтобы получить oid таблицы pg_class по её имени:
```
SELECT ___::regclass::oid;
```',
     '{"A":"`\"pg_class\"`","B":"`pg_class`","C":"`oid(pg_class)`","D":"`''pg_class''`"}'::jsonb,
     'D',
     'Имя приводится к regclass из строкового литерала; без кавычек pg_class будет воспринят как столбец.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Допишите запрос, чтобы выбрать только обычные таблицы:
```
SELECT relname FROM pg_class WHERE relkind = ___;
```',
     '{"A":"`''v''`","B":"`''r''`","C":"`''i''`","D":"`''t''`"}'::jsonb,
     'B',
     'relkind: r — таблица, i — индекс, v — представление, t — toast-таблица.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '09.'),
     'Допишите команду psql, чтобы увидеть подробное описание представления вместе с текстом запроса:
```
\d___ pg_views
```',
     '{"A":"`!`","B":"`+`","C":"`S`","D":"`x`"}'::jsonb,
     'B',
     'Модификатор + добавляет подробности, S включает в списки системные объекты.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Какие табличные пространства создаются при инициализации кластера?',
     '{"A":"`pg_global`","B":"`pg_default`","C":"`pg_temp`","D":"`pg_toast`"}'::jsonb,
     'AB',
     'pg_temp и pg_toast — это схемы, а не табличные пространства.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Что верно для табличных пространств?',
     '{"A":"Табличное пространство нельзя удалить","B":"Одна база может хранить объекты в нескольких табличных пространствах","C":"Схема и табличное пространство — одно и то же","D":"Одно табличное пространство могут использовать разные базы"}'::jsonb,
     'BD',
     'Логическое (базы, схемы) и физическое (табличные пространства) разделения независимы.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Где на диске находятся стандартные табличные пространства?',
     '{"A":"pg_global — в PGDATA/global","B":"Пользовательские — всегда внутри PGDATA/base","C":"pg_global — в PGDATA/pg_tblspc","D":"pg_default — в PGDATA/base"}'::jsonb,
     'AD',
     'Для пользовательских табличных пространств в PGDATA/pg_tblspc создаются символические ссылки на их каталоги.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Допишите команду создания табличного пространства:
```
CREATE TABLESPACE ts ___ ''/var/lib/postgresql/ts_dir'';
```',
     '{"A":"`DIRECTORY`","B":"`IN`","C":"`LOCATION`","D":"`PATH`"}'::jsonb,
     'C',
     'Каталог табличного пространства указывается в предложении LOCATION.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Допишите команду, чтобы создать таблицу в табличном пространстве ts:
```
CREATE TABLE t (id int) ___ ts;
```',
     '{"A":"`LOCATION`","B":"`ON`","C":"`IN`","D":"`TABLESPACE`"}'::jsonb,
     'D',
     'Без TABLESPACE таблица создаётся в табличном пространстве по умолчанию для базы.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '10.'),
     'Допишите команду, чтобы задать стоимость произвольного чтения страницы для табличного пространства:
```
ALTER TABLESPACE pg_default SET (___ = 1.1);
```',
     '{"A":"`random_page_cost`","B":"`seq_scan_cost`","C":"`page_cost`","D":"`work_mem`"}'::jsonb,
     'A',
     'Для табличного пространства можно задать seq_page_cost и random_page_cost, их использует планировщик.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Какие слои есть у обычной небольшой таблицы?',
     '{"A":"Слой инициализации (init)","B":"Карта видимости (vm)","C":"Карта свободного пространства (fsm)","D":"Основной слой"}'::jsonb,
     'BCD',
     'Слой init существует только у нежурналируемых таблиц и их индексов.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Что верно для TOAST?',
     '{"A":"Версия строки может занимать несколько страниц","B":"Toast-таблица читается только при обращении к длинному полю","C":"Toast-таблицы находятся в схеме public","D":"Длинные значения могут сжиматься"}'::jsonb,
     'BD',
     'Toast-таблицы лежат в схеме pg_toast, а любая версия строки должна помещаться на одну страницу.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Какие функции учитывают размер toast-части таблицы?',
     '{"A":"`pg_relation_size`","B":"`pg_table_size`","C":"`pg_total_relation_size`","D":"`pg_indexes_size`"}'::jsonb,
     'BC',
     'pg_relation_size показывает размер одного слоя, pg_indexes_size — только индексов таблицы.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Допишите команду, чтобы создать таблицу, изменения которой не пишутся в журнал предзаписи и которая видна всем сеансам:
```
CREATE ___ TABLE t (id int);
```',
     '{"A":"`FAST`","B":"`MEMORY`","C":"`NOLOG`","D":"`UNLOGGED`"}'::jsonb,
     'D',
     'После сбоя нежурналируемая таблица становится пустой.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Допишите вызов, чтобы получить размер карты видимости таблицы:
```
SELECT pg_relation_size(''t'', ___);
```',
     '{"A":"`''vm''`","B":"`''main''`","C":"`''fsm''`","D":"`''visibility''`"}'::jsonb,
     'A',
     'Второй параметр pg_relation_size — имя слоя: ''main'', ''fsm'', ''vm'' или ''init''.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '11.'),
     'Допишите команду, чтобы длинные значения выносились в TOAST без сжатия:
```
ALTER TABLE t ALTER COLUMN body SET STORAGE ___;
```',
     '{"A":"`extended`","B":"`external`","C":"`main`","D":"`plain`"}'::jsonb,
     'B',
     'extended — сжатие и вынос, main — сжатие без выноса по возможности, plain — без TOAST.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Какие параметры сбора статистики включены по умолчанию?',
     '{"A":"`track_functions`","B":"`track_io_timing`","C":"`track_counts`","D":"`track_activities`"}'::jsonb,
     'CD',
     'track_io_timing, track_functions и track_wal_io_timing по умолчанию выключены.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Каким приёмникам журнала сообщений нужен включённый коллектор?',
     '{"A":"`stderr`","B":"`syslog`","C":"`jsonlog`","D":"`csvlog`"}'::jsonb,
     'CD',
     'Коллектор включается параметром logging_collector.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Какие расширения входят в поставку PostgreSQL?',
     '{"A":"`pg_stat_statements`","B":"`pg_buffercache`","C":"`pg_wait_sampling`","D":"`pg_qualstats`"}'::jsonb,
     'AB',
     'pg_wait_sampling и pg_qualstats — сторонние расширения.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Допишите запрос, чтобы увидеть текущие активности сеансов:
```
SELECT pid, state, query FROM ___;
```',
     '{"A":"`pg_stat_activity`","B":"`pg_settings`","C":"`pg_stat_statements`","D":"`pg_locks`"}'::jsonb,
     'A',
     'pg_stat_statements хранит накопленную статистику по запросам, а не текущие активности.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Допишите команду, чтобы в журнал попадали команды, выполнявшиеся дольше секунды:
```
ALTER SYSTEM SET ___ = ''1s'';
SELECT pg_reload_conf();
```',
     '{"A":"`log_duration`","B":"`log_lock_waits`","C":"`log_min_duration_statement`","D":"`log_statement`"}'::jsonb,
     'C',
     'log_duration записывает время всех команд, log_statement — их текст, log_lock_waits — долгие ожидания блокировок.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '12.'),
     'Допишите команду перед установкой расширения pg_stat_statements (после неё нужен перезапуск сервера):
```
ALTER SYSTEM SET shared_preload_libraries = ___;
```',
     '{"A":"`''auto_explain''`","B":"`''pg_stat_statements''`","C":"`''pg_buffercache''`","D":"`''pgstattuple''`"}'::jsonb,
     'B',
     'Библиотека pg_stat_statements должна загружаться при старте сервера, затем выполняется CREATE EXTENSION.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Какие методы аутентификации запрашивают пароль?',
     '{"A":"`scram-sha-256`","B":"`md5`","C":"`peer`","D":"`trust`"}'::jsonb,
     'AB',
     'md5 объявлен устаревшим, peer спрашивает имя пользователя у ОС, trust разрешает вход без проверок.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Какие из перечисленных — привилегии для таблиц?',
     '{"A":"`TRUNCATE`","B":"`SELECT`","C":"`CONNECT`","D":"`USAGE`"}'::jsonb,
     'AB',
     'USAGE — привилегия схем и последовательностей, CONNECT — привилегия базы данных.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Что верно для владельца объекта?',
     '{"A":"Не может отозвать привилегии у самого себя","B":"Может удалить объект","C":"Владельцем может быть только суперпользователь","D":"Может выдавать и отзывать привилегии на объект"}'::jsonb,
     'BD',
     'Владелец сразу получает все привилегии и может даже отозвать их у себя, но право распоряжаться объектом за ним сохраняется.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Допишите команду выдачи привилегии:
```
GRANT SELECT ON accounts ___ reader;
```',
     '{"A":"`FROM`","B":"`FOR`","C":"`TO`","D":"`WITH`"}'::jsonb,
     'C',
     'GRANT ... TO выдаёт привилегии, REVOKE ... FROM отзывает.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Допишите строку pg_hba.conf, чтобы разрешить подключения из сети по паролю рекомендуемым методом:
```
# TYPE  DATABASE  USER  ADDRESS     METHOD
host    all       all   10.0.0.0/8  ___
```',
     '{"A":"`reject`","B":"`peer`","C":"`scram-sha-256`","D":"`trust`"}'::jsonb,
     'C',
     'peer работает только для локальных подключений, trust пускает без пароля, reject запрещает доступ.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '13.'),
     'Допишите команду, чтобы reader автоматически получал право чтения новых таблиц writer:
```
ALTER DEFAULT PRIVILEGES FOR ROLE writer IN SCHEMA public
    GRANT SELECT ON ___ TO reader;
```',
     '{"A":"`OBJECTS`","B":"`ALL TABLES`","C":"`TABLE`","D":"`TABLES`"}'::jsonb,
     'D',
     'В привилегиях по умолчанию тип объектов указывается во множественном числе: TABLES, SEQUENCES, FUNCTIONS.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Какие утилиты создают логическую резервную копию?',
     '{"A":"`pg_dumpall`","B":"`pg_receivewal`","C":"`pg_basebackup`","D":"`pg_dump`"}'::jsonb,
     'AD',
     'pg_basebackup делает физическую копию, pg_receivewal архивирует журнал.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Что нужно, чтобы pg_basebackup мог подключиться по протоколу репликации?',
     '{"A":"archive_mode = on","B":"wal_level не ниже replica","C":"Атрибут REPLICATION у роли (или суперпользователь)","D":"wal_level = logical"}'::jsonb,
     'BC',
     'Ещё нужны разрешение в pg_hba.conf и достаточное значение max_wal_senders. Настройки по умолчанию это допускают для локального подключения.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Что нужно для восстановления из базовой копии с архивом журналов?',
     '{"A":"Сигнальный файл recovery.signal","B":"Параметр archive_command на восстанавливаемом сервере","C":"Параметр restore_command","D":"Сигнальный файл standby.signal"}'::jsonb,
     'AC',
     'При необходимости задают и целевую точку восстановления. standby.signal запускает сервер в режиме реплики.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Допишите команду, чтобы сделать копию в специальном формате с оглавлением:
```
pg_dump ___ custom -f appdb.dump appdb
```',
     '{"A":"`-C`","B":"`-a`","C":"`-F`","D":"`-f`"}'::jsonb,
     'C',
     'Ключ -F задаёт формат, -f — имя файла. Такую копию восстанавливают утилитой pg_restore.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Допишите команду, чтобы выгрузить только роли и табличные пространства:
```
pg_dumpall ___ > globals.sql
```',
     '{"A":"`--globals-only`","B":"`--schema-only`","C":"`--roles-only`","D":"`--data-only`"}'::jsonb,
     'A',
     '--roles-only выгружает только роли, без табличных пространств.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '14.'),
     'Допишите команду, чтобы включить файловую архивацию журналов:
```
ALTER SYSTEM SET archive_mode = ___;
```',
     '{"A":"`on`","B":"`archive`","C":"`wal`","D":"`enable`"}'::jsonb,
     'A',
     'Также нужна archive_command, а изменение archive_mode требует перезапуска сервера.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Что запрещено на реплике в режиме горячего резерва?',
     '{"A":"`SET work_mem = ''64MB''`","B":"`INSERT`, `UPDATE`, `DELETE`","C":"`VACUUM`","D":"`SELECT`"}'::jsonb,
     'BC',
     'На реплике разрешены чтение, установка параметров сеанса и управление транзакциями.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Какие процессы участвуют в потоковой физической репликации?',
     '{"A":"autovacuum launcher","B":"walsender на основном сервере","C":"logical replication worker","D":"walreceiver на реплике"}'::jsonb,
     'BD',
     'Полученные записи на реплике применяет процесс startup.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Что верно для каскадной репликации?',
     '{"A":"Обратная связь поступает к основному серверу от всех реплик","B":"Дальние реплики отстают не больше ближних","C":"Уменьшает нагрузку на основной сервер","D":"Поддерживается каскадная синхронная репликация"}'::jsonb,
     'AC',
     'Синхронной может быть только реплика, подключённая к основному серверу напрямую.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Допишите команду на реплике, чтобы основной сервер учитывал её снимки при очистке:
```
ALTER SYSTEM SET ___ = on;
```',
     '{"A":"`hot_standby_feedback`","B":"`hot_standby`","C":"`synchronous_commit`","D":"`wal_receiver_feedback`"}'::jsonb,
     'A',
     'Обратная связь не даёт очистке на мастере удалять версии строк, нужные запросам на реплике.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Допишите команду на основном сервере, чтобы реплика с именем 16/replica стала синхронной:
```
ALTER SYSTEM SET synchronous_standby_names = ___;
```',
     '{"A":"`16/replica`","B":"`''replica''`","C":"`''\"16/replica\"''`","D":"`''16/replica''`"}'::jsonb,
     'C',
     'Имя со специальными символами внутри значения нужно заключать в двойные кавычки.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '15.'),
     'Допишите команду на реплике, чтобы не откладывать применение конфликтующих записей:
```
ALTER SYSTEM SET max_standby_streaming_delay = ___;
```',
     '{"A":"`''30s''`","B":"`0`","C":"`off`","D":"`-1`"}'::jsonb,
     'B',
     'Значение 0 прерывает конфликтующие запросы сразу, -1 ждёт бесконечно, по умолчанию 30 секунд.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Что не передаётся логической репликацией?',
     '{"A":"Значения последовательностей","B":"Команды DDL","C":"`INSERT`","D":"`TRUNCATE`"}'::jsonb,
     'AB',
     'Также не реплицируются большие объекты, представления и внешние таблицы.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Чем логическая репликация отличается от физической?',
     '{"A":"Можно реплицировать отдельные таблицы","B":"Подписчик доступен только для чтения","C":"Не нужна двоичная совместимость серверов","D":"Передаются страницы данных"}'::jsonb,
     'AC',
     'Подписчик работает в обычном режиме и может изменять данные.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Какими способами можно идентифицировать строки при логической репликации UPDATE и DELETE?',
     '{"A":"По ctid","B":"По номеру транзакции","C":"По первичному ключу","D":"По всем столбцам строки"}'::jsonb,
     'CD',
     'Ещё можно указать уникальный индекс с ограничением NOT NULL.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Допишите команду создания публикации:
```
CREATE PUBLICATION pub ___ TABLE accounts;
```',
     '{"A":"`ON`","B":"`FOR`","C":"`INCLUDE`","D":"`WITH`"}'::jsonb,
     'B',
     'CREATE PUBLICATION ... FOR TABLE перечисляет публикуемые таблицы.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Допишите команду создания подписки:
```
CREATE SUBSCRIPTION sub
    CONNECTION ''host=srv1 dbname=appdb''
    ___ pub;
```',
     '{"A":"`FROM`","B":"`TO`","C":"`SUBSCRIBE`","D":"`PUBLICATION`"}'::jsonb,
     'D',
     'Подписка указывает строку подключения и имена публикаций.'),
    ((SELECT id FROM categories WHERE left(name, 3) = '16.'),
     'Допишите команду, чтобы строки таблицы идентифицировались по всем столбцам:
```
ALTER TABLE accounts REPLICA IDENTITY ___;
```',
     '{"A":"`EVERY`","B":"`DEFAULT`","C":"`FULL`","D":"`ALL`"}'::jsonb,
     'C',
     'DEFAULT — по первичному ключу, USING INDEX — по уникальному индексу, NOTHING — без идентификации.');

COMMIT;
