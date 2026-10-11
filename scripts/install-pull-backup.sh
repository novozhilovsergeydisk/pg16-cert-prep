#!/bin/bash
# Установка (и переустановка) задачи launchd, которая скачивает на этот Mac копию базы с сервера.
#
#   scripts/install-pull-backup.sh            установить
#   scripts/install-pull-backup.sh --remove   удалить задачу (скачанные копии остаются)
#
# Задача запускается каждый день в 12:00 и при входе в систему; скрипт скачивает только новую копию.
set -euo pipefail
LABEL=ru.appuse.pg16-pull-backup
REPO=$(cd "$(dirname "$0")/.." && pwd)
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
    rm -f "$TARGET"
    echo "Задача $LABEL удалена."
    exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Backups/pg16-server"
chmod 700 "$HOME/Backups/pg16-server"
sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" "$REPO/scripts/launchd/$LABEL.plist" > "$TARGET"
plutil -lint "$TARGET" >/dev/null
launchctl bootstrap "$DOMAIN" "$TARGET"
echo "Задача $LABEL установлена: ежедневно в 12:00 и при входе в систему."
