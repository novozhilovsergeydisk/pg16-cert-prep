# Собеседование DBA: материал для изучения

Этот материал к разделу «17. Собеседование DBA». Вопросы взяты из реального собеседования на должность DBA PostgreSQL и в основном выходят за рамки курса DBA1. По каждой теме: суть, образцовый ответ, что спросят дальше и практика в консоли.

## Как пользоваться практикой

Все команды рассчитаны на отдельный учебный кластер. Рабочую базу не трогайте: команды из практики изменяют данные и останавливают серверы.

Команды PostgreSQL (`initdb`, `pg_ctl`, `psql`, `pg_dump`, `pg_basebackup` и другие) должны быть в `PATH`. В Debian они лежат в `/usr/lib/postgresql/16/bin`. Команды проверены на PostgreSQL 17; для 16 они те же, отличия отмечены в тексте.

Создайте учебный кластер на порту 5451. Он слушает только `127.0.0.1` и сам складывает WAL в каталог архива:

```
export PGDEMO=$HOME/pgdemo
mkdir -p $PGDEMO/archive
initdb -D $PGDEMO/main -U postgres --auth=trust
cat >> $PGDEMO/main/postgresql.conf <<EOF
port = 5451
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
archive_mode = on
archive_command = 'test ! -f $PGDEMO/archive/%f && cp %p $PGDEMO/archive/%f'
shared_preload_libraries = 'pg_stat_statements'
EOF
pg_ctl -D $PGDEMO/main -l $PGDEMO/main.log -w start
export PGHOST=127.0.0.1 PGPORT=5451 PGUSER=postgres
```

Если на macOS сервер не запускается с ошибкой про locale, выполните `export LC_ALL=en_US.UTF-8` и повторите запуск.

Создайте учебную базу с данными:

```
psql -c "CREATE DATABASE appdb"
psql -d appdb -c "CREATE TABLE orders AS SELECT g AS id, md5(g::text) AS note FROM generate_series(1,200000) g"
psql -d appdb -c "CREATE EXTENSION pg_stat_statements"
```

Архив WAL принадлежит только этому кластеру. Копию, которая запускается как отдельный сервер, запускайте с отключённой архивацией (`archive_mode = off`). Холодная копия остаётся на той же линии времени и начнёт писать свои сегменты под теми же именами в тот же архив, он заблокируется. После восстановления на момент (раздел 3) сервер переходит на новую линию времени и сегменты называются иначе, но и тогда общий архив лучше не смешивать.

Остановить и удалить кластер после занятий:

```
pg_ctl -D $PGDEMO/main stop -m fast
rm -rf $PGDEMO
```

## 1. Резервная копия и дамп

### Суть

Логическая копия (дамп) — это набор команд SQL, которые воссоздают объекты и данные. Её делают `pg_dump` для одной базы и `pg_dumpall` для всего кластера. Физическая копия — это копия файлов кластера плюс журнал WAL; её делает `pg_basebackup`.

Дамп гибкий: можно выгрузить одну таблицу или схему, восстановить на другой архитектуре и на той же или более новой основной версии PostgreSQL (в более старую версию загрузка не гарантируется и может потребовать правки SQL). Но восстановление медленное: выполняются все команды, строятся индексы. Восстановить можно только на момент снятия дампа.

Физическая копия восстанавливается быстро, а при наличии архива WAL позволяет восстановиться на любой момент после окончания копирования. Но она всегда целиком кластер, и разворачивается только на той же основной версии и архитектуре.

### Как ответить на собеседовании

«Логическая копия — это SQL-команды, физическая — файлы кластера и WAL. Дамп переносится между версиями и позволяет взять отдельную таблицу, но медленно восстанавливается и даёт состояние только на момент снятия. Физическая копия восстанавливается быстро и вместе с архивом WAL позволяет вернуться на любой момент, но только целиком и на той же основной версии. Для больших баз я делаю физические копии с архивом WAL, а дампы — для переноса и точечного восстановления».

### Что спросят дальше

- Мешает ли `pg_dump` работе? Читать и менять данные можно, дамп отражает один снимок. Но команды, которым нужна блокировка `ACCESS EXCLUSIVE` (`DROP TABLE`, большинство форм `ALTER TABLE`), будут ждать конца выгрузки. Долгая выгрузка ещё и удерживает горизонт очистки.
- Как восстановить одну таблицу? Из дампа в специальном формате: `pg_restore -t имя`. Зависимые объекты (типы, роли, объекты других таблиц) эта команда не восстанавливает; для сложных случаев нужные записи оглавления выбирают списком через `pg_restore -L`.
- Как ускорить большую выгрузку? Формат directory и параллельные процессы: `pg_dump -Fd -j 4`. Восстановление тоже можно ускорить: `pg_restore -j 4`.
- Почему базу для восстановления создают из `template0`? Иначе в неё попадут изменения из `template1`, и они могут конфликтовать с содержимым дампа.
- Что не входит в дамп базы? Роли и табличные пространства: они относятся ко всему кластеру. Их выгружает `pg_dumpall --globals-only`.

### Практика

Сделайте два дампа и сравните размеры:

```
pg_dump -Fc -f $PGDEMO/dump.custom appdb
pg_dump -f $PGDEMO/dump.sql appdb
ls -la $PGDEMO/dump.custom $PGDEMO/dump.sql
```

Ожидаем: формат custom сжат и обычно заметно меньше текстового SQL. Посмотрите оглавление копии:

```
pg_restore -l $PGDEMO/dump.custom
```

Восстановите в новую базу из `template0`:

```
createdb -T template0 appdb_restored
pg_restore -d appdb_restored $PGDEMO/dump.custom
psql -d appdb_restored -c "SELECT count(*) FROM orders"
```

Ожидаем 200000. Восстановите только одну таблицу и проверьте, что другие объекты не появились:

```
psql -d appdb -c "CREATE TABLE small AS SELECT g AS id FROM generate_series(1,10) g"
pg_dump -Fc -f $PGDEMO/dump2.custom appdb
createdb -T template0 appdb_part
pg_restore -d appdb_part -t small $PGDEMO/dump2.custom
psql -d appdb_part -c "\dt"
```

Параллельная выгрузка и роли с табличными пространствами:

```
pg_dump -Fd -j 2 -f $PGDEMO/dumpdir appdb
pg_dumpall --globals-only | head
```

Физическая копия кластера и её проверка:

```
pg_basebackup -D $PGDEMO/base1 -X stream -c fast
ls $PGDEMO/base1
pg_verifybackup $PGDEMO/base1
```

Ожидаем в каталоге файлы кластера, среди них `backup_label` и `backup_manifest`, а проверка завершается сообщением `backup successfully verified`.

## 2. Горячее и холодное копирование

### Суть

Холодная копия делается при остановленном сервере: останавливаете сервер, копируете каталог данных (и каталоги табличных пространств), запускаете сервер. Если сервер остановлен штатно, копия согласованна и дополнительный архив WAL не нужен, но каталог `pg_wal` из копии исключать нельзя: при запуске серверу нужна запись последней контрольной точки.

Горячая копия делается на работающем сервере. Файлы копируются в разное время, поэтому копия несогласованна, и согласованность восстанавливается при запуске по журналу WAL. Значит, нужны WAL как минимум за время копирования.

Самый простой способ горячей копии — `pg_basebackup`: он сам выполняет контрольную точку, копирует файлы и собирает нужные WAL. Низкоуровневый способ — функции `pg_backup_start` и `pg_backup_stop` и копирование файлов своими средствами; результат `pg_backup_stop` нужно сохранить в копии: содержимое `backup_label` и, если оно не пустое, содержимое `tablespace_map`.

### Как ответить на собеседовании

«Холодная копия — при остановленном сервере, горячая — на работающем. Для горячей я использую `pg_basebackup`; он выполняет контрольную точку и сохраняет WAL за время копирования, поэтому копия автономна. Если нужно копировать файлы самому, вызываю `pg_backup_start`, копирую каталог, затем `pg_backup_stop` и сохраняю возвращённые `backup_label` и непустой `tablespace_map` в копию».

### Что спросят дальше

- `pg_start_backup`. Так называлась функция начала копирования до PostgreSQL 15. В 15 её переименовали в `pg_backup_start` и одновременно убрали монопольный режим копирования, `pg_stop_backup` стала `pg_backup_stop`. В PostgreSQL 16 старых имён нет.
- `ALTER DATABASE … BEGIN BACKUP`. Такой команды в PostgreSQL нет. Это синтаксис Oracle (в Oracle режим копирования включается для базы или табличного пространства). Если на собеседовании её называют, это проверка на внимательность.
- Что важно при низкоуровневом копировании? Сеанс, который вызвал `pg_backup_start`, должен оставаться открытым до `pg_backup_stop`. Содержимое `backup_label` и непустое содержимое `tablespace_map`, которые возвращает `pg_backup_stop`, нужно сохранить в копии.
- Копируется ли отдельная база? Нет, физическая копия всегда весь кластер.

### Практика

Холодная копия. Для опыта используйте именно учебный кластер:

```
pg_ctl -D $PGDEMO/main stop -m fast
tar -czf $PGDEMO/cold.tgz -C $PGDEMO main
pg_ctl -D $PGDEMO/main -l $PGDEMO/main.log -w start
```

Горячая копия утилитой:

```
pg_basebackup -D $PGDEMO/base2 -X stream -c fast
```

Низкоуровневые функции. Вызывать их нужно в одном сеансе, поэтому обе команды идут в одном `psql`:

```
psql -c "SELECT pg_backup_start('lab', fast => true)" -c "SELECT * FROM pg_backup_stop()"
```

Ожидаем: первая команда возвращает позицию WAL, вторая — три значения: позицию окончания, содержимое `backup_label` (в нём строка `START WAL LOCATION`) и содержимое файла табличных пространств. В PostgreSQL 14 и ниже для этой же цели были `pg_start_backup` и `pg_stop_backup`.

## 3. Восстановление на момент в прошлом (PITR)

### Суть

Для PITR нужны два компонента: базовая физическая копия и непрерывный архив WAL от начала этой копии до нужного момента. Сервер разворачивает копию, затем проигрывает WAL из архива и останавливается в заданной точке.

Включают режим восстановления файлом `recovery.signal` в каталоге данных. Параметры задаются в `postgresql.conf`: `restore_command` — как получить сегмент из архива, `recovery_target_time` (или `_lsn`, `_xid`, `_name`) — до какого момента восстанавливаться, `recovery_target_action` — что делать, когда цель достигнута.

### Как ответить на собеседовании

«Нужна базовая копия и архив WAL, который непрерывен от копии до нужного момента. Разворачиваю копию, создаю `recovery.signal`, задаю `restore_command` и `recovery_target_time`, запускаю сервер. Он проигрывает WAL до цели и либо ставит восстановление на паузу, чтобы я проверил данные, либо сразу становится обычным сервером, если указано `promote`. Восстановиться раньше окончания базовой копии нельзя, поэтому копии делаю регулярно и храню несколько».

### Что спросят дальше

- Что делает сервер, дойдя до цели? Значение по умолчанию у `recovery_target_action` — `pause`: восстановление приостанавливается, чтобы можно было проверить данные. Продолжить можно функцией `pg_wal_replay_resume()`. Значение `promote` сразу делает сервер обычным.
- Что теряется, если сегмент WAL не попал в архив? Восстановление ограничено первым недостающим сегментом: недоступно всё, что записано начиная с него, если нет другого источника WAL. Это может быть и текущий незаполненный сегмент, и уже завершённый, но не заархивированный из-за сбоя или отставания архивации. Для минимизации потерь используют `archive_timeout`, потоковую архивацию `pg_receivewal` или репликацию.
- Как узнать момент перед ошибкой? По журналу сервера, по метке времени коммита (если включён `track_commit_timestamp`) или заранее создавая именованные точки `pg_create_restore_point('имя')`.
- Что сделать с восстановленной копией, чтобы она не мешала рабочей? Отключить `archive_mode` или направить архив в другой каталог, иначе она начнёт писать в тот же архив свои сегменты (уже с новой линией времени) и смешает истории.

### Практика

Пример полного цикла на учебном кластере. Базу `appdb` с таблицей `orders` вы создали в начале. Копия берётся в новый пустой каталог, поэтому `base_pitr`, а не каталоги из прошлых разделов.

1. Базовая копия. WAL в неё не нужны, они лежат в архиве:

```
pg_basebackup -D $PGDEMO/base_pitr -X none -c fast
```

2. Зафиксируйте момент до «ошибки», затем удалите таблицу и принудительно переключите сегмент, чтобы он попал в архив:

```
psql -d appdb -c "INSERT INTO orders VALUES (999999, 'до ошибки')"
T=$(psql -d appdb -At -c "SELECT now()::text")
echo "$T"
sleep 2
psql -d appdb -c "DROP TABLE orders"
psql -d appdb -c "SELECT pg_switch_wal()"
sleep 3
ls $PGDEMO/archive | wc -l
```

3. Разверните копию в новый каталог и настройте восстановление:

```
cp -R $PGDEMO/base_pitr $PGDEMO/restore1
cat >> $PGDEMO/restore1/postgresql.conf <<EOF
archive_mode = off
restore_command = 'cp $PGDEMO/archive/%f %p'
recovery_target_time = '$T'
recovery_target_action = 'promote'
EOF
touch $PGDEMO/restore1/recovery.signal
pg_ctl -D $PGDEMO/restore1 -l $PGDEMO/restore1.log -w -o "-p 5452" start
```

4. Проверьте результат:

```
PGPORT=5452 psql -d appdb -c "SELECT count(*), max(id) FROM orders"
PGPORT=5452 psql -c "SELECT pg_is_in_recovery()"
grep -E "recovery stopping|archive recovery complete" $PGDEMO/restore1.log
```

Ожидаем: таблица `orders` на месте, `200001 | 999999`, `pg_is_in_recovery` равно `f`, а в журнале строка `recovery stopping before commit of transaction …`. Остановите восстановленный кластер: `pg_ctl -D $PGDEMO/restore1 stop -m fast`.

Чтобы повторить цикл с `recovery_target_action = 'pause'`, сначала верните таблицу `orders` на основном сервере и возьмите новые каталоги (например, `base_pitr2` и `restore2`) и другой порт (например, 5455). После проверки данных выполните `SELECT pg_wal_replay_resume()`.

## 4. Мониторинг

### Суть

Мониторинг PostgreSQL состоит из трёх источников: представления статистики внутри сервера (`pg_stat_*`), журнал сообщений сервера и метрики операционной системы (процессор, диск, память, `iostat`, `vmstat`, `df`).

Главные представления: `pg_stat_activity` (кто что выполняет, состояния, ожидания), `pg_locks` и функция `pg_blocking_pids` (блокировки), `pg_stat_database` (транзакции, попадания в кеш, взаимоблокировки, временные файлы), `pg_stat_user_tables` (чтения, живые и мёртвые версии строк, время последней очистки и анализа), `pg_stat_replication` (репликация и отставание), расширение `pg_stat_statements` (статистика по запросам). Начиная с PostgreSQL 16 есть также `pg_stat_io`.

Внешние системы: Zabbix, Prometheus с `postgres_exporter` и Grafana, для анализа журнала — pgBadger, для истории по запросам — PoWA или pg_profile.

### Как ответить на собеседовании

«Смотрю на три уровня. Внутри сервера — `pg_stat_activity` на долгие запросы, `idle in transaction` и ожидания, `pg_stat_database` на долю попаданий в кеш и взаимоблокировки, `pg_stat_statements` на самые тяжёлые запросы, `pg_stat_user_tables` на мёртвые версии строк. В журнале — медленные запросы (`log_min_duration_statement`), ожидания блокировок (`log_lock_waits`), контрольные точки. На уровне ОС — диск и память. Для постоянного наблюдения использую Zabbix или Prometheus с Grafana, журнал разбираю pgBadger».

### Что спросят дальше

- Что такое buffer hit ratio? Доля блоков, которые нашлись в буферном кеше PostgreSQL: `blks_hit / (blks_hit + blks_read)`. Для OLTP обычно ожидают около 99%.
- Значит ли высокий hit ratio, что остальное читалось с диска? Нет: блок мог прийти из кеша операционной системы, PostgreSQL этого не видит. Физические чтения с диска определяют средствами ОС; `pg_stat_io` (PostgreSQL 16 и новее) показывает операции ввода-вывода самого PostgreSQL и тоже не отличает чтение с накопителя от чтения из кеша ОС. Ещё один нюанс: для отчётных запросов, которые читают большие таблицы целиком, низкий hit ratio нормален.
- Чем опасен `idle in transaction`? Сеанс держит блокировки и может удерживать горизонт очистки, из-за чего таблицы разрастаются. Ограничивают параметром `idle_in_transaction_session_timeout`.
- Как найти, кто кого блокирует? `pg_blocking_pids(pid)` и `pg_locks`.
- Что показать про репликацию? `pg_stat_replication`: состояние, `sync_state`, задержки `write_lag`, `flush_lag`, `replay_lag`.

### Практика

Доля попаданий в кеш:

```
psql -d appdb -c "SELECT datname, round(100.0*blks_hit/nullif(blks_hit+blks_read,0),2) AS hit_ratio FROM pg_stat_database WHERE datname='appdb'"
psql -d appdb -c "SELECT round(100.0*sum(heap_blks_hit)/nullif(sum(heap_blks_hit)+sum(heap_blks_read),0),2) AS table_hit_ratio FROM pg_statio_user_tables"
```

Самые тяжёлые запросы (нужны `shared_preload_libraries` и `CREATE EXTENSION`, которые вы уже сделали):

```
psql -d appdb -c "SELECT calls, round(total_exec_time::numeric,1) AS ms, left(query,60) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5"
```

Блокировки. Откройте два терминала с теми же переменными `PGHOST`, `PGPORT`, `PGUSER`. В первом создайте таблицу и удерживайте блокировку:

```
psql -d appdb -c "CREATE TABLE acc(id int primary key, v int); INSERT INTO acc VALUES (1,0)"
psql -d appdb
BEGIN;
UPDATE acc SET v = v + 1 WHERE id = 1;
```

Во втором выполните `UPDATE acc SET v = v + 10 WHERE id = 1;`, он повиснет. В третьем посмотрите, кто кого ждёт:

```
psql -d appdb -c "SELECT pid, pg_blocking_pids(pid) AS blocked_by, wait_event_type, wait_event, left(query,40) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0"
```

Ожидаем в `wait_event` значение `transactionid`, а в `blocked_by` — номер первого сеанса. Завершите первый сеанс командой `COMMIT;`.

Сеанс `idle in transaction`: в первом терминале выполните `BEGIN; SELECT 1;` и ничего не делайте, во втором:

```
psql -d appdb -c "SELECT pid, state, now()-xact_start AS xact_age FROM pg_stat_activity WHERE state = 'idle in transaction'"
psql -c "SHOW idle_in_transaction_session_timeout"
```

По умолчанию таймаут `0`, то есть выключен.

## 5. Репликация и synchronous_commit

### Суть

Параметр `synchronous_commit` определяет, когда транзакция считается зафиксированной для клиента. Пять значений, от слабого к строгому:

- `off`: фиксация не ждёт записи WAL на диск. При сбое могут потеряться последние подтверждённые транзакции (окно до трёх значений `wal_writer_delay`, по умолчанию около 0,6 секунды), но база остаётся согласованной.
- `local`: ждём записи WAL на диск основного сервера; синхронную реплику не ждём.
- `remote_write`: реплика приняла записи и передала их своей операционной системе, но на диск они ещё могли не попасть.
- `on` (по умолчанию): ждём сброса WAL на диск на основном сервере и, если задана синхронная реплика, на диск реплики.
- `remote_apply`: ждём, пока реплика применит записи, и после фиксации они уже видны запросам на реплике.

Синхронная реплика задаётся параметром `synchronous_standby_names`. Если он пуст, реплик никто не ждёт, и `on` означает только локальную запись на диск.

### Как ответить на собеседовании

«`off` — не ждём диска, возможна потеря последних транзакций без порчи базы. `local` — ждём только свой диск. `remote_write` — реплика приняла данные в память ОС. `on` — данные сброшены на диск реплики. `remote_apply` — реплика применила изменения, их видно в запросах на ней. Чем строже режим, тем надёжнее и тем медленнее фиксация. Параметр можно менять для сеанса и даже для одной транзакции через `SET LOCAL`, так критичные операции идут в строгом режиме, а остальные быстрее».

### Что спросят дальше

- Что будет, если синхронная реплика недоступна? При `on`, `remote_write` и `remote_apply` фиксации на основном сервере зависают в ожидании. Прервать ожидание можно отменой запроса: транзакция при этом уже зафиксирована локально, но может быть не передана реплике.
- Как задать несколько реплик? `synchronous_standby_names = 'FIRST 1 (a, b)'` или `'ANY 1 (a, b)'`.
- Чем `on` отличается от `remote_apply`? При `on` данные на диске реплики, но запрос на реплике может ещё не увидеть изменение. При `remote_apply` увидит.
- Защищает ли синхронная репликация от потери данных при сбое основного сервера? Да, зафиксированные транзакции уже на синхронной реплике.

### Практика

Создайте реплику с именем `standby1` и сделайте её синхронной:

```
pg_basebackup -D $PGDEMO/standby1 -R -X stream -c fast -d "host=127.0.0.1 port=5451 user=postgres application_name=standby1"
sed -i.bak "s/^port = 5451/port = 5453/" $PGDEMO/standby1/postgresql.conf
pg_ctl -D $PGDEMO/standby1 -l $PGDEMO/standby1.log -w start
psql -c "SELECT application_name, state, sync_state FROM pg_stat_replication"
psql -c "ALTER SYSTEM SET synchronous_standby_names = 'standby1'" -c "SELECT pg_reload_conf()"
psql -c "SELECT application_name, sync_state FROM pg_stat_replication"
```

Ожидаем: сначала `async`, после перечитывания настроек `sync`. Параметр `-R` создаёт `standby.signal` и строку подключения.

`remote_apply`: запись на основном сервере и чтение на реплике сразу после фиксации:

```
psql -d appdb -c "CREATE TABLE t_sync(id int)"
for i in 1 2 3; do
  psql -d appdb -c "SET synchronous_commit = remote_apply; INSERT INTO t_sync VALUES ($i)"
  PGPORT=5453 psql -d appdb -At -c "SELECT count(*) FROM t_sync"
done
```

Ожидаем 1, 2, 3: каждая вставка видна на реплике сразу.

Остановите реплику и попробуйте зафиксировать транзакцию:

```
pg_ctl -D $PGDEMO/standby1 stop -m fast
psql -d appdb -c "INSERT INTO t_sync VALUES (100)"
```

Команда зависнет. В другом терминале найдите ожидание и отмените его:

```
psql -c "SELECT pid, wait_event_type, wait_event, left(query,40) FROM pg_stat_activity WHERE wait_event = 'SyncRep'"
psql -c "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE wait_event = 'SyncRep'"
```

Ожидаем `IPC` и `SyncRep`, а у зависшего сеанса сообщение `WARNING: canceling wait for synchronous replication due to user request` с пояснением, что транзакция уже зафиксирована локально. Режимы `local` и `off` при остановленной реплике не ждут:

```
psql -d appdb -c "SET synchronous_commit = local; INSERT INTO t_sync VALUES (101)"
psql -d appdb -c "SET synchronous_commit = off; INSERT INTO t_sync VALUES (102)"
```

Значение для одной транзакции:

```
psql -d appdb <<'SQL'
BEGIN;
SET LOCAL synchronous_commit = off;
SHOW synchronous_commit;
COMMIT;
SHOW synchronous_commit;
SQL
```

Ожидаем `off`, а после фиксации снова `on`. Верните реплику: `pg_ctl -D $PGDEMO/standby1 -l $PGDEMO/standby1.log -w start`.

## 6. Транзакции и ACID

### Суть

ACID — четыре свойства транзакции.

- Атомарность (Atomicity): все изменения транзакции применяются целиком или не применяются вообще. В PostgreSQL помогают версии строк: откат просто делает новые версии невидимыми.
- Согласованность (Consistency): транзакция переводит базу из одного корректного состояния в другое. Ограничения (`PRIMARY KEY`, `FOREIGN KEY`, `CHECK`) не дают зафиксировать данные, которые их нарушают.
- Изолированность (Isolation): параллельные транзакции не мешают друг другу. Степень изоляции задаёт уровень. В PostgreSQL три реальных уровня: `READ COMMITTED` (по умолчанию), `REPEATABLE READ`, `SERIALIZABLE`. Уровень `READ UNCOMMITTED` принимается, но работает как `READ COMMITTED`.
- Стойкость (Durability): зафиксированные изменения переживают сбой. Обеспечивает запись WAL на диск при фиксации.

### Как ответить на собеседовании

«Атомарность — всё или ничего. Согласованность — ограничения целостности соблюдены. Изоляция — транзакции не видят чужих незафиксированных изменений, степень зависит от уровня. Стойкость — после COMMIT данные не потеряются, потому что WAL сброшен на диск. В PostgreSQL по умолчанию `READ COMMITTED`: каждый оператор видит данные, зафиксированные к его началу. На `REPEATABLE READ` транзакция работает с одним снимком данных до конца».

### Что спросят дальше

- Транзакционны ли DDL? Да, большинство: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `TRUNCATE` можно выполнить в транзакции и откатить. Исключения: `CREATE DATABASE`, `DROP DATABASE`, `VACUUM`, `CREATE INDEX CONCURRENTLY` и некоторые другие команды нельзя выполнять внутри блока транзакции.
- Что делают DDL с блокировками? `ALTER TABLE` и другие берут сильные блокировки (часто `ACCESS EXCLUSIVE`). Если он ждёт, а за ним выстроилась очередь, обычные запросы к таблице тоже встанут. На рабочих системах перед DDL ставят `lock_timeout`.
- Чем DML отличается от DDL с точки зрения транзакций? Оба откатываются, но `INSERT`, `UPDATE`, `DELETE` берут лёгкие блокировки строк и не мешают читателям.
- Что такое «грязное чтение» и бывает ли оно в PostgreSQL? Чтение незафиксированных данных. В PostgreSQL его нет ни на одном уровне.
- Как связаны стойкость и `synchronous_commit`? При `off` стойкость ослаблена: последние транзакции могут пропасть при сбое.

### Практика

Откат DDL:

```
psql -d appdb <<'SQL'
BEGIN;
CREATE TABLE tx_demo(id int);
ROLLBACK;
SELECT to_regclass('tx_demo') IS NULL AS "таблицы нет";
SQL
```

Ожидаем `t`. Команда, которую нельзя выполнить в транзакции:

```
psql -d appdb <<'SQL'
BEGIN;
CREATE DATABASE tx_db;
SQL
```

Ожидаем `ERROR: CREATE DATABASE cannot run inside a transaction block`.

Уровень изоляции:

```
psql -d appdb -c "SHOW transaction_isolation"
```

Разница уровней. Нужны два терминала. В обоих `PGHOST`, `PGPORT`, `PGUSER`. Подготовка:

```
psql -d appdb -c "CREATE TABLE iso(v int); INSERT INTO iso VALUES (1)"
```

Терминал A:

```
psql -d appdb
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT v FROM iso;
```

Терминал B:

```
psql -d appdb -c "UPDATE iso SET v = v + 1"
```

Вернитесь в A и повторите `SELECT v FROM iso;`. Ожидаем, что значение изменилось (на `READ COMMITTED` оператор видит новые зафиксированные данные). Выполните `COMMIT;` в A и повторите опыт, заменив первую строку на `BEGIN ISOLATION LEVEL REPEATABLE READ;`. Теперь повторный `SELECT` в A показывает прежнее значение: транзакция держит свой снимок.

## 7. Место на диске после удаления данных

### Суть

`DELETE` в PostgreSQL не стирает строки, а помечает версии строк как удалённые. Эти мёртвые версии убирает очистка (`VACUUM`, чаще всего автоочистка). После очистки место внутри файла таблицы становится свободным для новых строк этой же таблицы, но размер файла на диске обычно не уменьшается. Уменьшается только если пустые страницы оказались в конце файла.

Чтобы вернуть место операционной системе: `VACUUM FULL` (полностью перезаписывает таблицу и индексы), `TRUNCATE` (если нужно удалить все строки) или внешняя утилита `pg_repack`, которая делает то же без долгой блокировки.

### Как ответить на собеседовании

«После `DELETE` место не освобождается: версии строк только помечаются удалёнными. `VACUUM` делает место пригодным для повторного использования внутри таблицы, но файл не уменьшает, кроме пустого хвоста. Если нужно вернуть место системе, использую `VACUUM FULL` в окно обслуживания: он блокирует таблицу и ему нужно место для новой копии. Без блокировки — `pg_repack`. Если нужно удалить всё, делаю `TRUNCATE`. А чтобы не накапливалось, настраиваю автоочистку и слежу за мёртвыми версиями в `pg_stat_user_tables`».

### Что спросят дальше

- Что нужно учитывать при `VACUUM FULL`? Блокировка `ACCESS EXCLUSIVE`: таблица недоступна даже для чтения. Нужно свободное место для новой копии таблицы и индексов.
- Почему `VACUUM` иногда ничего не освобождает? Если живые строки остались в конце файла, хвост не пустой. Или очистке мешает старая транзакция, которая удерживает горизонт очистки.
- Как измерить раздутие (bloat)? Расширение `pgstattuple` показывает мёртвые версии и свободное место, а оценочные запросы дают приблизительную картину. Число `n_dead_tup` в `pg_stat_user_tables` — оценка для очистки; оно показывает, что накопились мёртвые версии, но после `VACUUM` может быть нулём, хотя файл по-прежнему хранит много свободного места.
- Что ещё занимает место? Журнал WAL (`pg_wal`), который удерживают неиспользуемые слоты репликации или неработающая архивация, временные файлы, журналы сообщений, индексы.

### Практика

Создайте таблицу с индексом и запишите размеры. Каждую команду выполняйте отдельным вызовом `psql`: так статистика сеанса успеет попасть в общую.

```
psql -d appdb -c "CREATE TABLE big AS SELECT g AS id, repeat('x', 100) AS pad FROM generate_series(1,300000) g"
psql -d appdb -c "ALTER TABLE big ADD PRIMARY KEY (id)"
psql -d appdb -c "SELECT pg_size_pretty(pg_relation_size('big')) AS table_size, pg_size_pretty(pg_total_relation_size('big')) AS with_indexes"
```

Удалите 90% строк (самые первые) и посмотрите размер и мёртвые версии:

```
psql -d appdb -c "DELETE FROM big WHERE id <= 270000"
psql -d appdb -c "SELECT pg_size_pretty(pg_relation_size('big')) AS after_delete"
psql -d appdb -c "SELECT n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE relname = 'big'"
```

Ожидаем: размер после `DELETE` не изменился, мёртвых версий около 270000 (число приблизительное; автоочистка может уже начать работу). Оценим раздутие расширением `pgstattuple` до и после `VACUUM`:

```
psql -d appdb -c "CREATE EXTENSION pgstattuple"
psql -d appdb -c "SELECT dead_tuple_percent, free_percent FROM pgstattuple('big')"
psql -d appdb -c "VACUUM big"
psql -d appdb -c "SELECT dead_tuple_percent, free_percent FROM pgstattuple('big')"
psql -d appdb -c "SELECT pg_size_pretty(pg_relation_size('big'))"
```

Ожидаем: до `VACUUM` около 82% мёртвых версий и почти нет свободного места; после — мёртвых 0%, но свободного места около 90%. Файл при этом не уменьшился: оставшиеся строки лежат в его конце, хвост не пустой. Именно поэтому `n_dead_tup` после очистки мало говорит о раздутии.

Перезапись таблицы возвращает место системе:

```
psql -d appdb -c "VACUUM FULL big"
psql -d appdb -c "SELECT pg_size_pretty(pg_total_relation_size('big'))"
```

Размер упал примерно в десять раз. Теперь проверим, что `VACUUM` возвращает пустой хвост. Очистите таблицу, заполните заново и удалите строки из конца:

```
psql -d appdb -c "TRUNCATE big"
psql -d appdb -c "INSERT INTO big SELECT g, repeat('x',100) FROM generate_series(1,300000) g"
psql -d appdb -c "SELECT pg_size_pretty(pg_relation_size('big')) AS before_delete"
psql -d appdb -c "DELETE FROM big WHERE id > 10000"
psql -d appdb -c "VACUUM big"
psql -d appdb -c "SELECT pg_size_pretty(pg_relation_size('big')) AS after_vacuum"
```

Ожидаем, что размер заметно уменьшился: пустые страницы в конце файла возвращены системе. Полное удаление:

```
psql -d appdb -c "TRUNCATE big"
psql -d appdb -c "SELECT pg_size_pretty(pg_total_relation_size('big'))"
```

Размер базы и самых крупных таблиц:

```
psql -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC"
psql -d appdb -c "SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace ORDER BY pg_total_relation_size(oid) DESC LIMIT 5"
```

## 8. Планы запросов и статистика

### Суть

План запроса строит планировщик по оценкам, а оценки берёт из статистики о данных. Статистику собирает `ANALYZE`, в рабочей системе его обычно запускает автоочистка, когда в таблице изменилось достаточно строк: порог `autovacuum_analyze_threshold` (по умолчанию 50) плюс доля таблицы `autovacuum_analyze_scale_factor` (по умолчанию 0,1). Статистика лежит в `pg_statistic`, читаемый вид — представление `pg_stats`: число различных значений, частые значения, гистограмма, корреляция с физическим порядком.

Подготовленный оператор (`PREPARE`, или запрос через драйвер с параметрами) может иметь два вида плана. Частный (custom) план строится с учётом значений параметров. Общий (generic) план строится без значений и переиспользуется. Общий экономит время планирования, но для неравномерных данных может оказаться плохим.

### Как ответить на собеседовании

«Частный план строится под конкретные значения параметров, общий — один на все значения. По умолчанию `plan_cache_mode = auto`: первые пять выполнений идут с частными планами, затем сервер сравнивает среднюю стоимость частных планов со стоимостью общего и может перейти на общий. Для неравномерных данных я могу принудительно задать `force_custom_plan`. Статистику собирает `ANALYZE`, обычно автоочистка. Если планировщик ошибается, сравниваю оценку и факт в `EXPLAIN (ANALYZE)`. Для связанных столбцов использую `CREATE STATISTICS`: обычная статистика считает столбцы независимыми, и из-за этого оценка может быть заметно занижена или завышена».

### Что спросят дальше

- Как изменить детальность статистики? `default_statistics_target` (по умолчанию 100) или для одного столбца `ALTER TABLE … ALTER COLUMN … SET STATISTICS n`, затем `ANALYZE`.
- Зачем `CREATE STATISTICS`? Собирает расширенную статистику по нескольким столбцам: зависимости (`dependencies`), число различных сочетаний (`ndistinct`), частые сочетания (`mcv`). Сама команда только создаёт объект, данные появятся после `ANALYZE`.
- Как увидеть общий план? В PostgreSQL 16 и новее — `EXPLAIN (GENERIC_PLAN)`. В более старых — установить `plan_cache_mode = force_generic_plan` и выполнить `EXPLAIN EXECUTE`: после пяти выполнений в режиме `auto` сервер не обязан перейти на общий план.
- Почему оценка и факт расходятся? Устаревшая статистика, коррелирующие столбцы, неравномерное распределение, функции в условиях.
- Что с оператором без параметров? Разницы между общим и частным планом нет: используется общий план сразу.

### Практика

Неравномерные данные: почти все строки `common`, редкие `rare`:

```
psql -d appdb <<'SQL'
CREATE TABLE skew AS SELECT g AS id, CASE WHEN g % 1000 = 0 THEN 'rare' ELSE 'common' END AS status FROM generate_series(1,200000) g;
CREATE INDEX ON skew(status);
ANALYZE skew;
SELECT attname, n_distinct, null_frac FROM pg_stats WHERE tablename = 'skew' AND attname = 'status';
SQL
```

Подготовленный оператор и его планы. Все команды в одном сеансе:

```
psql -d appdb <<'SQL'
PREPARE q(text) AS SELECT count(*) FROM skew WHERE status = $1;
EXPLAIN (COSTS OFF) EXECUTE q('rare');
EXECUTE q('rare'); EXECUTE q('rare'); EXECUTE q('rare'); EXECUTE q('rare');
EXPLAIN (COSTS OFF) EXECUTE q('rare');
SELECT name, generic_plans, custom_plans FROM pg_prepared_statements;
SET plan_cache_mode = force_generic_plan;
EXPLAIN (COSTS OFF) EXECUTE q('common');
SET plan_cache_mode = force_custom_plan;
EXPLAIN (COSTS OFF) EXECUTE q('common');
SQL
```

Ожидаем: в частном плане в условии подставлено значение (`status = 'rare'::text`). В общем плане для `common` условие содержит `$1` и применяется индекс, хотя для этого значения почти вся таблица, и последовательное чтение выгоднее. С `force_custom_plan` для `common` выбирается последовательное чтение. Общий план без выполнения (PostgreSQL 16 и новее):

```
psql -d appdb -c "EXPLAIN (GENERIC_PLAN, COSTS OFF) SELECT count(*) FROM skew WHERE status = \$1"
```

Расширенная статистика. В таблице город и почтовый индекс полностью связаны:

```
psql -d appdb <<'SQL'
CREATE TABLE addr AS SELECT g AS id, g % 100 AS city, g % 100 AS zip FROM generate_series(1,100000) g;
ANALYZE addr;
EXPLAIN (ANALYZE, TIMING OFF, SUMMARY OFF) SELECT * FROM addr WHERE city = 7 AND zip = 7;
CREATE STATISTICS addr_dep (dependencies) ON city, zip FROM addr;
ANALYZE addr;
EXPLAIN (ANALYZE, TIMING OFF, SUMMARY OFF) SELECT * FROM addr WHERE city = 7 AND zip = 7;
SELECT statistics_name, attnames, dependencies FROM pg_stats_ext WHERE statistics_name = 'addr_dep';
SQL
```

Ожидаем: до расширенной статистики оценка около 10 строк при фактических 1000, после неё около 1000. В нашем запуске было `rows=9` и `rows=1037`; точные числа немного меняются, потому что `ANALYZE` берёт случайную выборку. Автоматический сбор статистики:

```
psql -c "SHOW autovacuum_analyze_threshold" -c "SHOW autovacuum_analyze_scale_factor" -c "SHOW default_statistics_target"
psql -d appdb -c "SELECT relname, last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname IN ('skew','addr')"
```

## Чек-лист перед собеседованием

- Объясните разницу между дампом и физической копией и скажите, что подходит для переноса на другую версию.
- Назовите функции горячего копирования в PostgreSQL 16 и объясните, почему `pg_start_backup` и `ALTER DATABASE … BEGIN BACKUP` не подходят.
- Опишите шаги PITR и условия, при которых цель недостижима.
- Перечислите, что смотрите при мониторинге, и объясните формулу buffer hit ratio и её ограничение.
- Назовите пять значений `synchronous_commit` и что гарантирует каждое.
- Расскажите ACID на примере и скажите, какие команды нельзя выполнить в транзакции.
- Объясните, почему `DELETE` не освобождает место и чем отличаются `VACUUM`, `VACUUM FULL` и `TRUNCATE`.
- Объясните общий и частный планы, как собирается статистика и зачем `CREATE STATISTICS`.
