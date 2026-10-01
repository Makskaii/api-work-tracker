#!/usr/bin/env bash
set -euo pipefail

source_root=${1:?Pass the private uploaded integration directory}
backup_root=${2:?Pass a new private backup directory outside the website}
document_root=/home/bitrix/www
target_root="$document_root/local/php_interface/evolution/dev_tasks"
activity_root="$document_root/local/activities/evolutiondevtaskguard"
init_file="$document_root/bitrix/php_interface/init.php"

case "$backup_root" in
    /root/evolution-dev-tasks-backup-*) ;;
    *) printf 'Refusing a non-private backup path.\n' >&2; exit 1 ;;
esac
if [ -e "$backup_root" ]; then
    printf 'Use a fresh backup directory for each deployment.\n' >&2
    exit 1
fi

while IFS= read -r -d '' php_file; do
    php -l "$php_file"
done < <(find "$source_root" -name '*.php' ! -name '._*' -print0)
php "$source_root/tests/template.php"
php "$source_root/tests/guard-policy.php"
php "$source_root/tests/notifications.php"
if [ -f "$source_root/tests/guard-adapter.php" ]; then
    php "$source_root/tests/guard-adapter.php"
fi
php "$source_root/tests/notification-delivery.php"

mkdir -m 700 "$backup_root"
cp -p "$init_file" "$backup_root/init.php"
if [ -d "$target_root" ]; then cp -a "$target_root" "$backup_root/dev_tasks"; fi
if [ -d "$activity_root" ]; then cp -a "$activity_root" "$backup_root/evolutiondevtaskguard"; fi

install -d -o bitrix -g bitrix -m 755 "$target_root/src" "$activity_root"
install -o bitrix -g bitrix -m 644 "$source_root/bootstrap.php" "$target_root/bootstrap.php"
for php_file in "$source_root"/src/*.php; do
    install -o bitrix -g bitrix -m 644 "$php_file" "$target_root/src/"
done
install -o bitrix -g bitrix -m 644 "$source_root/activities/evolutiondevtaskguard/.description.php" "$activity_root/.description.php"
install -o bitrix -g bitrix -m 644 "$source_root/activities/evolutiondevtaskguard/evolutiondevtaskguard.php" "$activity_root/evolutiondevtaskguard.php"

# Validate native Bitrix workflow metadata before enabling any new action.
php "$source_root/tools/configure.php" check "$document_root"
php "$source_root/tools/diagnose.php" "$document_root"

if ! grep -Fq '/local/php_interface/evolution/dev_tasks/bootstrap.php' "$init_file"; then
    init_candidate="$backup_root/init-candidate.php"
    cp -p "$init_file" "$init_candidate"
    cat >> "$init_candidate" <<'PHP'

// Evolution: Development task guard and scheduled deadline/hour notifications.
require_once $_SERVER['DOCUMENT_ROOT'] . '/local/php_interface/evolution/dev_tasks/bootstrap.php';
PHP
    php -l "$init_candidate"
    # Same filesystem, atomic rename, preserve the existing owner/mode.
    cp -p "$init_candidate" "$init_file.evolution-new"
    chown --reference="$init_file" "$init_file.evolution-new"
    chmod --reference="$init_file" "$init_file.evolution-new"
    mv "$init_file.evolution-new" "$init_file"
fi

php "$source_root/tools/configure.php" apply "$document_root" "$backup_root"
php "$source_root/tools/configure.php" check "$document_root"
printf 'Private backup: %s\n' "$backup_root"
