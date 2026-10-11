#!/bin/bash

# Настройки подключения, хранения и журнала.
HOST=appuse
REMOTE_DIR=/root/backups/pg16_cert
PATTERN='pg16_cert-*.sql.gz'
LOCAL_DIR="$HOME/Backups/pg16-server"
KEEP=12
LOG="$LOCAL_DIR/pull.log"

set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin

# Системные сообщения могут содержать адреса: выводим только свои сообщения.
exec 2>/dev/null
LOCK="$LOCAL_DIR/.lock"
LOCK_ID=''
PART=''
ERROR_REPORTED=0
BACKUP_RE='^pg16_cert-[0-9]{8}-[0-9]{6}\.sql\.gz$'

log() {
    local line
    line="$(date '+%Y-%m-%d %H:%M:%S') $*"
    printf '%s\n' "$line"
    printf '%s\n' "$line" >> "$LOG"
}

fail() {
    ERROR_REPORTED=1
    log "Ошибка: $*" || :
    exit 1
}

# Идентификатор позволяет отличить нашу блокировку от созданной позднее.
lock_id() {
    stat -f '%d:%i:%B' "$LOCK"
}

# Освобождение и снятие устаревшей блокировки используют общий захват.
# Перемещение каталога исключает удаление новой блокировки другим процессом.
# Код 2 означает, что каталог уже изменился или его освобождает другой процесс.
retire_lock() {
    local expected="$1" actual retired
    if ! mkdir "$LOCK/.retiring"; then
        [ -d "$LOCK/.retiring" ] && return 2
        [ "$(lock_id || :)" != "$expected" ] && return 2
        return 1
    fi
    actual=$(lock_id) || return 1
    if [ "$actual" != "$expected" ]; then
        rmdir "$LOCK/.retiring" || return 1
        return 2
    fi
    retired=$(mktemp -d "$LOCAL_DIR/.lock-retired.XXXXXXXX") || {
        rmdir "$LOCK/.retiring" || :
        return 1
    }
    if ! mv "$LOCK" "$retired/lock"; then
        rmdir "$retired" || :
        rmdir "$LOCK/.retiring" || :
        return 1
    fi
    rmdir "$retired/lock/.retiring" "$retired/lock" "$retired" || return 1
}

# EXIT обрабатывает также неожиданные ошибки set -e и прерывания сигналами.
cleanup() {
    local rc="$1" release_rc=0
    trap - EXIT HUP INT TERM
    if [ -n "$PART" ]; then
        rm -f "$PART" || rc=1
    fi
    if [ -n "$LOCK_ID" ] && [ "$(lock_id || :)" = "$LOCK_ID" ]; then
        retire_lock "$LOCK_ID" || release_rc=$?
        if [ "$release_rc" -eq 1 ]; then
            rc=1
        fi
    fi
    if [ "$rc" -ne 0 ]; then
        if [ "$ERROR_REPORTED" -eq 0 ]; then
            log "Ошибка: выполнение прервано (код $rc)" || :
        fi
        osascript -e 'display notification "Копия базы не скачана, подробности в pull.log" with title "pg16-cert-prep"' >/dev/null 2>&1 || :
    fi
    exit "$rc"
}
trap 'cleanup "$?"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || fail 'KEEP должен быть положительным целым числом'

# Возраст каталога берём через BSD stat. При занятой свежей блокировке
# выходим без сообщений и без удаления чужого временного файла.
while ! mkdir "$LOCK"; do
    [ ! -L "$LOCK" ] || fail 'каталог блокировки оказался символической ссылкой'
    if [ ! -d "$LOCK" ]; then
        [ ! -e "$LOCK" ] || fail 'неверный тип блокировки'
        # Каталог мог исчезнуть при одновременном завершении другого запуска.
        mkdir "$LOCK" && break
        [ -d "$LOCK" ] || fail 'не удалось создать блокировку'
    fi
    observed_id=$(lock_id) || continue
    modified=$(stat -f '%m' "$LOCK") || continue
    now=$(date '+%s')
    [ "$((now - modified))" -ge 7200 ] || exit 0
    # Если процесс погиб во время освобождения, его служебный каталог
    # также можно снять после двух часов; свежий захват не трогаем.
    if [ -d "$LOCK/.retiring" ]; then
        retiring_time=$(stat -f '%m' "$LOCK/.retiring") || continue
        [ "$((now - retiring_time))" -ge 7200 ] || exit 0
        if ! rmdir "$LOCK/.retiring"; then
            [ ! -d "$LOCK/.retiring" ] && continue
            fail 'не удалось снять устаревший служебный захват'
        fi
    fi
    retire_rc=0
    retire_lock "$observed_id" || retire_rc=$?
    [ "$retire_rc" -ne 1 ] || fail 'не удалось снять устаревшую блокировку'
    [ "$retire_rc" -ne 2 ] || exit 0
done
LOCK_ID=$(lock_id)

# Удаляем только незавершённые загрузки нашей маски, уже под блокировкой.
for old_part in "$LOCAL_DIR"/pg16_cert-*.sql.gz.part; do
    if [ -f "$old_part" ] || [ -L "$old_part" ]; then
        rm -f "$old_part"
    fi
done

# Список строится из локальных файлов, без обхода подкаталогов. Необычные
# имена с переводами строк отклоняем, чтобы сортировка была однозначной.
prune() {
    local path name
    for path in "$LOCAL_DIR"/pg16_cert-*.sql.gz; do
        [ -f "$path" ] || continue
        name=${path##*/}
        [[ "$name" != *$'\n'* ]] || fail 'перевод строки в имени локальной копии'
    done
    {
        for path in "$LOCAL_DIR"/pg16_cert-*.sql.gz; do
            [ -f "$path" ] || continue
            printf '%s\n' "${path##*/}"
        done
    } | LC_ALL=C sort -r | tail -n "+$((KEEP + 1))" |
        while IFS= read -r name; do
            case "$name" in
                */*) exit 1 ;;
                pg16_cert-*.sql.gz) rm -f "$LOCAL_DIR/$name" ;;
                *) exit 1 ;;
            esac
        done
}

# Кавычки для пути внутри команды удалённой оболочки.
quote_remote() {
    printf "'%s'" "${1//\'/\'\\\'\'}"
}
remote_dir_q=$(quote_remote "$REMOTE_DIR")
if latest=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
    "ls -1 $remote_dir_q/$PATTERN 2>/dev/null | LC_ALL=C sort | tail -n 1" 2>/dev/null); then
    [ -n "$latest" ] || fail 'на сервере нет подходящих копий'
else
    status=$?
    fail "не удалось получить список копий (код ssh: $status)"
fi
name=${latest##*/}
[[ "$name" =~ $BACKUP_RE ]] || fail 'сервер вернул недопустимое имя копии'
FINAL="$LOCAL_DIR/$name"

if [ -f "$FINAL" ] && [ ! -L "$FINAL" ]; then
    log "уже есть: $name"
    prune
    exit 0
fi
[ ! -e "$FINAL" ] && [ ! -L "$FINAL" ] || fail 'итоговый путь занят неподходящим объектом'

# До окончания всех проверок копия имеет только временное имя.
PART="$FINAL.part"
if scp -q -o BatchMode=yes -o ConnectTimeout=15 \
    "$HOST:$REMOTE_DIR/$name" "$PART" >/dev/null 2>&1; then
    :
else
    status=$?
    fail "не удалось скачать копию (код scp: $status)"
fi
remote_file_q=$(quote_remote "$REMOTE_DIR/$name")
if remote_hash_line=$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
    "sha256sum $remote_file_q" 2>/dev/null); then
    :
else
    status=$?
    fail "не удалось получить контрольную сумму (код ssh: $status)"
fi
local_hash_line=$(shasum -a 256 "$PART") || fail 'не удалось вычислить контрольную сумму'
# read выделяет первое поле, не исполняя и не печатая ответ сервера.
IFS=$' \t' read -r remote_hash ignored <<< "$remote_hash_line"
IFS=$' \t' read -r local_hash ignored <<< "$local_hash_line"
[[ "$remote_hash" =~ ^[0-9a-f]{64}$ ]] || fail 'сервер вернул неверную контрольную сумму'
[ "$remote_hash" = "$local_hash" ] || fail 'контрольные суммы SHA-256 не совпали'
gzip -t "$PART" || fail 'архив повреждён'

# После grep -q дочитываем поток через cat: gzip не получает SIGPIPE.
# pipefail при этом сохраняет настоящие ошибки распаковки и чтения.
if gzip -dc "$PART" | {
    found=0
    grep -q '^COPY public\.questions ' || found=$?
    cat >/dev/null || exit 1
    exit "$found"
}; then
    :
else
    fail 'в архиве нет COPY public.questions либо произошла ошибка чтения'
fi
[ -s "$PART" ] || fail 'скачан пустой файл'
mv "$PART" "$FINAL"
PART=''
chmod 600 "$FINAL"
prune
log "ок: скачана и проверена копия $name"
