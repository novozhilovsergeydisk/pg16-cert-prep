# Московское время журналов PostgreSQL на appuse

Команды для самостоятельного выполнения. На foolish-magenta уже подтверждены
log_timezone = Europe/Moscow и pending_restart = f. Здесь настраивается **appuse**,
кластер PostgreSQL 16/main на порту 5432.

Выполняйте шаги последовательно. Если команда завершилась ошибкой, остановитесь
и сохраните её вывод для разбора.

## 1. Подключиться с Mac

```bash
ssh appuse
```

Далее команды выполняются на сервере от root. Проверьте имя сервера:

```bash
hostname -s
```

Ожидается appuse. Если показано foolish-magenta, перейдите на нужный сервер.

## 2. Сохранить резервную копию

```bash
pg_logtz_backup=$(mktemp -d /root/pg16-log-timezone.XXXXXX)
echo "$pg_logtz_backup"
```

На экране появится путь к закрытому каталогу резервной копии.
Переменная действует в текущей оболочке; export не нужен.

```bash
test -n "$pg_logtz_backup" && cp -a /var/lib/postgresql/16/main/postgresql.auto.conf "$pg_logtz_backup/"
```

Проверить, что копия появилась:

```bash
ls -l "$pg_logtz_backup/postgresql.auto.conf"
```

Содержимое файла выводить не нужно. cp -a сохраняет владельца, права и временные
метки; исходный файл не меняется.

## 3. Сохранить настройку

```bash
sudo -u postgres psql -X -p 5432 -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER SYSTEM SET log_timezone = 'Europe/Moscow';"
```

Ожидается ALTER SYSTEM. Команда записывает параметр в postgresql.auto.conf
для всего кластера 16/main. Это ещё не проверка применения настройки.

## 4. Перечитать конфигурацию

```bash
sudo -u postgres psql -X -p 5432 -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_reload_conf();"
```

Ожидается t: сервер получил запрос на перечитывание конфигурации.
Перезапуск PostgreSQL и перезагрузка сервера не нужны.

## 5. Проверить результат отдельным подключением

```bash
sudo -u postgres psql -X -p 5432 -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT name, setting, pending_restart FROM pg_settings WHERE name = 'log_timezone';"
```

Ожидается:

```text
     name     |    setting    | pending_restart
--------------+---------------+-----------------
 log_timezone | Europe/Moscow | f
```

Если сразу видно прежнее значение, подождите секунду и повторите проверку.
Если оно не изменилось, сохраните результат для разбора.

Новые строки журнала будут использовать московское время. Старые строки
сохранят исходные временные метки. SQL-параметр TimeZone эти команды не меняют.
Часовой пояс ОС appuse уже проверен: Europe/Moscow.

## Справка по команде psql

- sudo -u postgres — запуск от системного пользователя postgres;
- -X — не читать .psqlrc;
- -p 5432 — порт выбранного экземпляра;
- -d postgres — база подключения; настройка применяется ко всему кластеру;
- -v ON_ERROR_STOP=1 — завершаться с ошибкой при SQL-ошибке;
- -c — выполнить SQL и завершить клиент;
- обратная косая черта в конце строки — продолжение команды оболочки.

Документация: https://www.postgresql.org/docs/16/sql-altersystem.html
