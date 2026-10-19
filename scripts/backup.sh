#!/bin/zsh
# Резервная копия базы (безопасно при работающем боте: sqlite .backup учитывает WAL). Хранит 14 последних.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/backups
file="data/backups/eng-bot-$(date +%Y%m%d-%H%M%S).sqlite"
/usr/bin/sqlite3 data/eng-bot.sqlite ".backup '$file'"
# Копия — один самодостаточный файл, без -wal/-shm.
/usr/bin/sqlite3 "$file" "pragma journal_mode=delete;" > /dev/null
/usr/bin/sqlite3 "$file" "pragma integrity_check;" | grep -qx ok || { echo "$(date) integrity check FAILED: $file" >&2; exit 1; }
rm -f -- "$file-wal" "$file-shm"
ls -1t data/backups/eng-bot-*.sqlite | tail -n +15 | while read -r old; do rm -f -- "$old" "$old-wal" "$old-shm"; done
echo "$(date '+%F %T') backup ok: $file ($(du -h "$file" | cut -f1))"
# Логи бота: launchd дописывает их бесконечно. Больше 10 МБ — в .1 (предыдущий .1 затирается), сам лог обнуляется
# (бот пишет с O_APPEND, так что дальше просто продолжит с начала файла).
for log in data/logs/bot.log data/logs/bot.err.log; do
  if [[ -f "$log" && $(stat -f%z "$log") -gt 10485760 ]]; then
    cp "$log" "$log.1" && : > "$log"
    echo "$(date '+%F %T') rotated $log"
  fi
done
