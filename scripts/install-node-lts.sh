#!/bin/bash
# Отдельный runtime приложения. Не меняет /usr/bin/node, PATH системы или службы.
set -euo pipefail
umask 022

node_version=v24.22.2
archive="node-$node_version-linux-x64.tar.xz"
archive_sha256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
release_signer=5BE8A3F6C8A5C01D106C0AD820B1A390B168D356
keyring_revision=481637f813e912c4aa3622d7964ab426c97b8e8d
runtime_root=/opt/pg16-cert-prep
destination="$runtime_root/node-$node_version-linux-x64"

if [ "$(uname -sm)" != 'Linux x86_64' ] || [ "$(id -u)" -ne 0 ]; then
    echo 'Требуются Linux x86_64 и root; установка предназначена только для сервера приложения.' >&2
    exit 1
fi
for required_tool in curl gpgv tar sha256sum awk stat find; do
    command -v "$required_tool" >/dev/null || { echo "Не найдена команда: $required_tool" >&2; exit 1; }
done
if [ -e "$destination" ] || [ -L "$destination" ]; then
    echo 'Целевой каталог уже существует; автоматическая перезапись запрещена.' >&2
    exit 1
fi
if [ -L "$runtime_root" ]; then
    echo 'Каталог runtime не должен быть символической ссылкой.' >&2
    exit 1
fi
if [ -e "$runtime_root" ] && { [ ! -d "$runtime_root" ] || [ "$(stat -c %u "$runtime_root")" -ne 0 ] || [ -n "$(find "$runtime_root" -maxdepth 0 -perm /022 -print)" ]; }; then
    echo 'Каталог runtime должен принадлежать root и быть закрыт для записи группе и остальным.' >&2
    exit 1
fi
if [ ! -d "$runtime_root" ]; then
    install -d -m 755 -o root -g root "$runtime_root"
fi

work_dir=$(mktemp -d "$runtime_root/.node-install.XXXXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT
install -d -m 700 "$work_dir/gnupg"
download() {
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
        --connect-timeout 10 --max-time 180 "$1" -o "$2"
}
download "https://nodejs.org/dist/$node_version/SHASUMS256.txt.asc" "$work_dir/SHASUMS256.txt.asc"
download "https://raw.githubusercontent.com/nodejs/release-keys/$keyring_revision/gpg/pubring.kbx" "$work_dir/pubring.kbx"
gpgv --homedir "$work_dir/gnupg" --keyring "$work_dir/pubring.kbx" --status-fd 1 \
    "$work_dir/SHASUMS256.txt.asc" > "$work_dir/gpg-status" 2> "$work_dir/gpg.log"
awk -v signer="$release_signer" '$2 == "VALIDSIG" && ($3 == signer || $NF == signer) { valid = 1 } END { exit !valid }' "$work_dir/gpg-status"
test "$(awk -v file="$archive" '$2 == file { print $1 }' "$work_dir/SHASUMS256.txt.asc")" = "$archive_sha256"
download "https://nodejs.org/dist/$node_version/$archive" "$work_dir/$archive"
printf '%s  %s\n' "$archive_sha256" "$work_dir/$archive" | sha256sum --check --status
tar --extract --xz --file "$work_dir/$archive" --directory "$work_dir" --no-same-owner
test "$("$work_dir/node-$node_version-linux-x64/bin/node" --version)" = "$node_version"
chmod -R go-w "$work_dir/node-$node_version-linux-x64"
mv "$work_dir/node-$node_version-linux-x64" "$destination"
printf 'Установлен %s; подпись и SHA-256 проверены.\n' "$destination"
