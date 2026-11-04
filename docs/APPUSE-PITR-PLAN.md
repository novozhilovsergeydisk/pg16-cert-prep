# Сервер appuse: физическое резервирование 16/main с архивом WAL в Амстердаме

**Схема: ежедневная полная копия плюс непрерывный архив WAL.** Это не репликация: резервного сервера нет,
в Амстердаме хранятся только базовые копии и архив WAL; кластер там поднимается лишь для проверки восстановления.

Дата плана: 05.11.2026. Статус: **не начато** — этапы A–G ниже ещё не выполнялись, на серверах ничего не менялось.

Цель: непрерывное архивирование WAL и ежедневные базовые копии кластера PostgreSQL 16/main сервера `appuse`
на сервер `vpn-amsterdam`, с возможностью восстановления на любой момент времени (PITR) и проверкой восстановления.

Порядок работы: команды выполняет пользователь в своём терминале на Mac, по одному шагу, и присылает вывод.
Перед каждой правкой на `appuse` — резервная копия (на сервере девять чужих сайтов). Адреса серверов в документ
не пишем — команды используют SSH-псевдонимы `appuse` и `vpn-amsterdam` из `~/.ssh/config` на Mac.
Секреты (токен Telegram-бота, закрытые ключи) не выводить ни в каком виде.

## Исходное состояние (осмотр 04–05.11.2026)

**appuse** (Петербург, Debian 12):
- PostgreSQL 16.14, кластер **16/main**, порт 5432: 22 базы, вместе около 200 МБ; каталог данных 1,1 ГБ;
  `pg_wal` 832 МБ; `max_wal_size = 1GB`; `wal_level = replica`; `archive_mode = off`.
- Запись WAL небольшая: 92 МБ с 15.07.2026 (`pg_stat_wal`), то есть меньше 1 МБ в сутки.
- Диск 32 ГБ, занято 80%, свободно 6,1 ГБ — главный риск: если архив застрянет, `pg_wal` будет расти.
- Память 3,8 ГБ.
- Прочие кластеры — остатки упражнений, **не трогать без решения пользователя**: 17/main (порт 5433, пустой),
  16/training (выключен; порт 5433 занят 17/main), 16/trainrepl (порт 5434, в recovery без ведущего).

**vpn-amsterdam** (Нидерланды, Debian 12):
- 1 процессор, 890 МБ памяти, свободно 4,4 ГБ из 12 ГБ.
- PostgreSQL 16.13 установлен (кластеры 15/main и 16/training выключены); мажорная версия совпадает с appuse.
- `rsync` не установлен.

## Решения пользователя (05.11.2026)

1. Резервируем только кластер **16/main**.
2. Только штатные средства PostgreSQL: `archive_command` → `gzip` → `rsync` по SSH; `pg_basebackup`;
   `pg_archivecleanup`. pgBackRest не используем.
3. `apt install rsync` на Амстердаме — да.
4. Базовая копия **раз в день** (решение 05.11.2026, вместо раза в неделю); хранить **14 последних ежедневных копий** и WAL, нужный для них — окно восстановления 14 дней.
5. `archive_timeout = 300` — потеря не больше 5 минут работы.
6. Контроль архива с уведомлением в **Telegram**.
7. Перезапуск 16/main (нужен для `archive_mode = on`) — **ночью**.

Ожидаемый объём в Амстердаме: WAL ~10–20 МБ в сутки после сжатия (закрытый по таймеру сегмент почти весь из
нулей), ~300 МБ за 14 дней; 14 базовых копий по ~50 МБ — ~700 МБ. Итого около 1 ГБ из 4,4 ГБ свободных.

## Схема

- На Амстердаме пользователь `walarchive`, хранилище `/srv/pgbackup/appuse/{wal,base}`.
- У пользователя `postgres` на appuse отдельный ключ `id_walarchive`. В Амстердаме этот ключ ограничен:
  `restrict,command="/usr/bin/rrsync -wo -no-del /srv/pgbackup/appuse"` — только запись в папку архива,
  без чтения и удаления. Взлом appuse не даёт стереть архив через этот ключ.
- Сроки хранения соблюдает cron на самом Амстердаме.
- Восстановление (тест) — на Амстердаме, WAL читается из локальной папки.

## A. Амстердам: хранилище

**A1. Установить rsync.**
```bash
ssh vpn-amsterdam 'apt-get update -qq && apt-get install -y rsync && rsync --version | head -1 && ls -l /usr/bin/rrsync'
```
Ожидается `rsync version 3.2.7` и файл `/usr/bin/rrsync`.

**A2. Пользователь и папки** (права 700, владелец `walarchive`).
```bash
ssh vpn-amsterdam 'useradd --system --create-home --home-dir /srv/pgbackup --shell /bin/sh walarchive && install -d -o walarchive -g walarchive -m 700 /srv/pgbackup/.ssh /srv/pgbackup/appuse /srv/pgbackup/appuse/wal /srv/pgbackup/appuse/base && ls -la /srv/pgbackup /srv/pgbackup/appuse'
```

## B. Ключ между серверами

**B1. Ключ у postgres на appuse** (выводится только отпечаток).
```bash
ssh appuse 'sudo -u postgres install -d -m 700 /var/lib/postgresql/.ssh && sudo -u postgres ssh-keygen -q -t ed25519 -N "" -C "postgres@appuse wal-archive" -f /var/lib/postgresql/.ssh/id_walarchive && sudo -u postgres ssh-keygen -lf /var/lib/postgresql/.ssh/id_walarchive.pub'
```

**B2. Разрешить ключ в Амстердаме с ограничением.** Публичная часть идёт по конвейеру через Mac, на экран
не выводится; в конце — только отпечаток.
```bash
ssh appuse 'cat /var/lib/postgresql/.ssh/id_walarchive.pub' | ssh vpn-amsterdam 'k=$(cat); printf "restrict,command=\"/usr/bin/rrsync -wo -no-del /srv/pgbackup/appuse\" %s\n" "$k" >> /srv/pgbackup/.ssh/authorized_keys && chown walarchive:walarchive /srv/pgbackup/.ssh/authorized_keys && chmod 600 /srv/pgbackup/.ssh/authorized_keys && ssh-keygen -lf /srv/pgbackup/.ssh/authorized_keys'
```
Отпечаток должен совпасть с B1.

**B3. Ключ хоста Амстердама — по отпечатку, не вслепую.** Сначала отпечаток с самого Амстердама:
```bash
ssh vpn-amsterdam 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'
```
Затем то, что видит appuse (адрес берётся из `~/.ssh/config` на Mac):
```bash
AMS=$(ssh -G vpn-amsterdam | awk '/^hostname /{print $2}'); ssh appuse "ssh-keyscan -t ed25519 $AMS 2>/dev/null | tee /tmp/ams-hostkey | ssh-keygen -lf -"
```
Если отпечатки совпали — записать ключ хоста и настройку SSH для postgres:
```bash
AMS=$(ssh -G vpn-amsterdam | awk '/^hostname /{print $2}'); ssh appuse "sudo -u postgres sh -c 'cat /tmp/ams-hostkey >> /var/lib/postgresql/.ssh/known_hosts; printf \"Host pgarchive\n  HostName $AMS\n  User walarchive\n  IdentityFile ~/.ssh/id_walarchive\n  IdentitiesOnly yes\n  BatchMode yes\n  ConnectTimeout 10\n\" >> /var/lib/postgresql/.ssh/config; chmod 600 /var/lib/postgresql/.ssh/config' && rm /tmp/ams-hostkey && echo ok"
```

**B4. Проверка: запись работает, чтение запрещено.**
```bash
ssh appuse 'echo test > /tmp/walarchive-test && sudo -u postgres rsync --fsync /tmp/walarchive-test pgarchive:wal/ && echo "запись: ok"; sudo -u postgres rsync pgarchive:wal/walarchive-test /tmp/walarchive-back 2>/dev/null && echo "чтение: РАЗРЕШЕНО — ошибка" || echo "чтение: запрещено, как надо"; rm -f /tmp/walarchive-test /tmp/walarchive-back'
```
```bash
ssh vpn-amsterdam 'ls -l /srv/pgbackup/appuse/wal/ && rm /srv/pgbackup/appuse/wal/walarchive-test'
```

## C. appuse: настройка архива (без перезапуска)

**C1. Резервные копии конфигурации.**
```bash
ssh appuse 'cp -a /var/lib/postgresql/16/main/postgresql.auto.conf /var/lib/postgresql/16/main/postgresql.auto.conf.bak-$(date +%Y-%m-%d) && tar -czf /root/pg16-conf-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /etc/postgresql/16 main && ls -l /root/pg16-conf-backup-* /var/lib/postgresql/16/main/postgresql.auto.conf*'
```

**C2. Скрипт архивации** `/usr/local/bin/pg-wal-archive`. Ненулевой код возврата → PostgreSQL повторит
отправку позже. `--ignore-existing`: уже отправленный сегмент (повтор после сбоя) не перезаписывается.
`rsync` пишет во временный файл и переименовывает — частичных файлов в архиве не бывает.
```bash
ssh appuse 'cat > /usr/local/bin/pg-wal-archive && chmod 755 /usr/local/bin/pg-wal-archive && echo ok' <<'EOF'
#!/bin/sh
# archive_command = '/usr/local/bin/pg-wal-archive %p %f'
set -eu
src="$1"; name="$2"
tmp=/var/lib/postgresql/wal-archive-tmp
mkdir -p -m 700 "$tmp"
gzip -c -6 "$src" > "$tmp/$name.gz"
rsync --fsync --ignore-existing --timeout=60 "$tmp/$name.gz" "pgarchive:wal/$name.gz"
rm -f "$tmp/$name.gz"
EOF
```

**C3. Проверка скрипта на тестовом файле.**
```bash
ssh appuse 'head -c 65536 /dev/urandom > /tmp/TESTSEG && chmod 644 /tmp/TESTSEG && sudo -u postgres /usr/local/bin/pg-wal-archive /tmp/TESTSEG TESTSEG && echo "скрипт: ok"; rm -f /tmp/TESTSEG'
```
```bash
ssh vpn-amsterdam 'ls -l /srv/pgbackup/appuse/wal/ && rm /srv/pgbackup/appuse/wal/TESTSEG.gz'
```

**C4. Параметры.** `archive_command` и `archive_timeout` применятся сразу, `archive_mode` — после перезапуска
(в выводе у него `pending_restart = t`).
```bash
ssh appuse 'sudo -u postgres psql -X -v ON_ERROR_STOP=1' <<'EOF'
ALTER SYSTEM SET archive_command = '/usr/local/bin/pg-wal-archive %p %f';
ALTER SYSTEM SET archive_timeout = 300;
ALTER SYSTEM SET archive_mode = on;
SELECT pg_reload_conf();
SELECT name, setting, pending_restart FROM pg_settings WHERE name LIKE 'archive%';
EOF
```

## D. Ночью: перезапуск и проверка

```bash
ssh appuse 'systemctl restart postgresql@16-main && pg_lsclusters'
```
```bash
ssh appuse 'sudo -u postgres psql -Atc "select pg_switch_wal()" && sleep 10 && sudo -u postgres psql -Atc "select archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal from pg_stat_archiver"'
```
```bash
ssh vpn-amsterdam 'ls -lh /srv/pgbackup/appuse/wal | tail -5'
```
Ожидается: `failed_count = 0`, в Амстердаме появились файлы `*.gz`. Затем проверить, что сайты живы
(`systemctl --failed`, открыть сайты), и через 10–15 минут — что сегменты продолжают уходить.

Откат: `ALTER SYSTEM RESET archive_mode; ALTER SYSTEM RESET archive_command; ALTER SYSTEM RESET archive_timeout;`
и перезапуск, либо вернуть `postgresql.auto.conf.bak-…` из C1.

## E. Базовые копии и срок хранения

**E1. Скрипт базовой копии на appuse** `/usr/local/bin/pg-base-backup` (запуск от postgres по cron каждый день
в 03:30). `-X none` — WAL берётся из архива. В конце — метка успешной копии для контроля (F).
```sh
#!/bin/sh
set -eu
stamp=$(date +%Y%m%d-%H%M%S)
dir=/var/lib/postgresql/basebackup-tmp/$stamp
mkdir -p -m 700 "$dir"
pg_basebackup -D "$dir" -Ft -z -X none -c fast -l "daily $stamp"
rsync -r --fsync --timeout=600 "$dir" pgarchive:base/
rm -rf "$dir"
touch /var/lib/postgresql/.last-basebackup-ok
```
Первую копию снять вручную сразу после этапа D.

**E2. Срок хранения на Амстердаме** `/usr/local/bin/pg-archive-retention` (cron root ежедневно в 05:00, после прихода
копии): оставить 14 последних базовых копий, удалить WAL старше начала самой старой из них.
```sh
#!/bin/sh
set -eu
B=/srv/pgbackup/appuse/base; W=/srv/pgbackup/appuse/wal
ls -1d "$B"/*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
oldest=$(ls -1d "$B"/*/ 2>/dev/null | sort | head -1)
[ -n "$oldest" ] || exit 0
seg=$(tar -xzOf "$oldest/base.tar.gz" backup_label | sed -n 's/^START WAL LOCATION: .*(file \([0-9A-F]*\)).*/\1/p')
[ -n "$seg" ] && /usr/lib/postgresql/16/bin/pg_archivecleanup -x .gz "$W" "$seg"
```
Сначала проверить с ключом `-n` у `pg_archivecleanup` (только показать, что будет удалено).

## F. Контроль архива → Telegram

Скрипт на appuse `/usr/local/bin/pg-archive-alert`, cron postgres каждые 5 минут. Сигнал «плохо»: в
`pg_wal/archive_status` больше 12 файлов `*.ready` (час неотправленных сегментов) или последней удачной базовой копии
больше 36 часов (пропущена ночь). Сообщение уходит только при смене состояния (плохо → хорошо и обратно).

Токен и чат — в файле `/etc/pg-archive-alert.env` (`root:postgres`, права 640), переменные `TG_TOKEN`, `TG_CHAT`.
Файл заполняет пользователь сам, значения на экран не выводятся. Токен передаётся `curl` через `--config -`,
поэтому не виден в списке процессов; вывод `curl` подавлен, текст ошибок с URL никуда не попадает.
```sh
#!/bin/sh
set -u
. /etc/pg-archive-alert.env
ready=$(find /var/lib/postgresql/16/main/pg_wal/archive_status -name '*.ready' | wc -l)
state=ok; why=""
[ "$ready" -gt 12 ] && { state=fail; why="не отправлено сегментов WAL: $ready"; }
if [ -z "$(find /var/lib/postgresql/.last-basebackup-ok -mmin -2160 2>/dev/null)" ]; then
  state=fail; why="$why; базовой копии больше 36 часов"
fi
st=/var/lib/postgresql/.archive-alert-state
prev=$(cat "$st" 2>/dev/null || echo ok)
[ "$state" = "$prev" ] && exit 0
if [ "$state" = fail ]; then msg="appuse: резервирование PostgreSQL — проблема: $why"; else msg="appuse: резервирование PostgreSQL снова в порядке"; fi
curl -s -o /dev/null --max-time 20 --config - 2>/dev/null <<CFG && echo "$state" > "$st"
url = "https://api.telegram.org/bot${TG_TOKEN}/sendMessage"
data-urlencode = "chat_id=${TG_CHAT}"
data-urlencode = "text=${msg}"
CFG
```
Включать после первой базовой копии (E1), иначе сразу сработает «копии больше 36 часов».
Бот: **@FlowboxNotifyBot** (указан пользователем 05.11.2026). Чат: **личный чат пользователя с ботом** (решение 05.11.2026);
перед получением номера чата пользователь пишет боту `/start`. Токен пользователь сам вписывает в
`/etc/pg-archive-alert.env`. Номер чата узнать
так, чтобы токен не попал на экран: токен читать из этого файла, через `getUpdates` выводить только `chat.id` и
`chat.title`/`chat.type`.

## G. Проверка восстановления на Амстердаме

1. На appuse поставить метку и запомнить время T между двумя записями:
   ```bash
   ssh appuse 'sudo -u postgres psql -X -Atc "create table if not exists pitr_marker(t timestamptz default now(), note text)" -c "insert into pitr_marker(note) values (\$\$before\$\$)" -c "select now()" && sleep 5 && sudo -u postgres psql -X -Atc "insert into pitr_marker(note) values (\$\$after\$\$)" -c "select pg_switch_wal()"'
   ```
2. На Амстердаме дать пользователю postgres чтение архива (группа `walarchive`, папки 750), развернуть последнюю
   базовую копию во временный каталог (например `/srv/pgrestore/16`), создать `recovery.signal`, указать
   `restore_command = 'gunzip -c /srv/pgbackup/appuse/wal/%f.gz > %p'`, `recovery_target_time = 'T'`,
   `recovery_target_action = 'pause'`, порт 5440, `shared_buffers = 64MB` (на сервере 890 МБ памяти).
3. Запустить `pg_ctl -D /srv/pgrestore/16 start`, проверить: в `pitr_marker` есть `before` и нет `after`.
4. Остановить и удалить тестовый кластер. Таблицу `pitr_marker` на appuse удалить.

Точные команды шага G — при выполнении, после этапов A–F.

## Ход работ

- 05.11.2026 — осмотр, решения, этот план. Этапы A–G не начаты.
- 05.11.2026 — базовая копия раз в день вместо раза в неделю, хранить 14 копий; контроль — копии не старше 36 часов.
