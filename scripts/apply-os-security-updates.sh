#!/bin/bash
# Run only with an inspected, frozen security plan and completed private backups.
set -euo pipefail
umask 077

if [ "$(id -u)" -ne 0 ] || [ "$(uname -s)" != Linux ]; then
    echo 'Требуются Linux и root.' >&2
    exit 1
fi
backup_dir=$(readlink -f "${1:?Укажите закрытый каталог резервной копии}")
case "$backup_dir" in /root/ssh-backups/pg16-os-*) ;; *) echo 'Неверный каталог резервной копии.' >&2; exit 1 ;; esac
test -f "$backup_dir/backups.complete"
test -s "$backup_dir/security-plan.json"
test -s "$backup_dir/etc.before.tar.gz"
test -s "$backup_dir/dpkg-status.before"
test -d "$backup_dir/previous-packages"
test "$(stat -c %u "$backup_dir")" -eq 0
test -z "$(find "$backup_dir" -maxdepth 0 -perm /077 -print)"

script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
policy_source="$script_dir/../deploy/maintenance/policy-rc.d"
policy_target=/usr/sbin/policy-rc.d
test -s "$policy_source"

python3 - "$backup_dir" <<'PY'
import apt, pathlib, json, re, sys
backup=pathlib.Path(sys.argv[1]);plan=json.loads((backup/'security-plan.json').read_text());cache=apt.Cache()
assert plan and len(list((backup/'previous-packages').glob('*.deb')))==len(plan)
specs=[]
for row in plan:
    name,version=row['package'],row['security_version']
    assert re.fullmatch(r'[a-z0-9][a-z0-9+.-]*',name)
    assert re.fullmatch(r'[A-Za-z0-9.+:~_-]+',version)
    pkg=cache[name];assert pkg.is_installed and pkg.installed.version==row['installed']
    selected=next(v for v in pkg.versions if v.version==version)
    assert any(o.trusted and o.origin in ['Debian','Ubuntu'] and ('security' in o.archive.lower() or o.label=='Debian-Security') for o in selected.origins)
    specs.append(name+'='+version)
(backup/'package-specs.txt').write_text('\n'.join(specs)+'\n')
PY
mapfile -t package_specs < "$backup_dir/package-specs.txt"
test "${#package_specs[@]}" -gt 0

if [ -e "$policy_target" ] || [ -L "$policy_target" ]; then
    cp -a "$policy_target" "$backup_dir/policy-rc.d.before"
    printf 'present\n' > "$backup_dir/policy-rc.d.state"
else
    printf 'absent\n' > "$backup_dir/policy-rc.d.state"
fi
restore_policy() {
    if cmp -s "$policy_target" "$policy_source"; then
        mv "$policy_target" "$backup_dir/policy-rc.d.used"
        if [ -e "$backup_dir/policy-rc.d.before" ] || [ -L "$backup_dir/policy-rc.d.before" ]; then
            cp -a "$backup_dir/policy-rc.d.before" "$policy_target"
        fi
        printf 'POLICY_RESTORED\n'
    else
        echo 'Временная policy-rc.d изменилась извне: требуется адресная проверка.' >&2
        return 1
    fi
}
install -m 755 -o root -g root "$policy_source" "$policy_target"
trap restore_policy EXIT
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get -y --no-remove --no-install-recommends \
    -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
    install --only-upgrade "${package_specs[@]}"
printf 'SECURITY_PACKAGES_INSTALLED\n'
