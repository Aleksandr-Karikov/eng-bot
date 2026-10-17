#!/bin/zsh
# Ставит два LaunchAgent'а текущего пользователя:
#   com.engbot.bot    — бот: старт при входе в систему, перезапуск при падении, мак не засыпает, пока бот работает;
#   com.engbot.backup — бэкап базы каждый день в 04:00 (если мак спал — сразу после пробуждения).
# Логи: data/logs/. Удалить: scripts/launchd/uninstall.sh
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
NODE=/opt/homebrew/opt/node@24/bin/node
[ -x "$NODE" ] || NODE=$(command -v node)
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
PATH_VALUE="/opt/homebrew/bin:$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$AGENTS" "$REPO/data/logs"

cat > "$AGENTS/com.engbot.bot.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.engbot.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$NODE</string><string>$REPO/node_modules/tsx/dist/cli.mjs</string><string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH_VALUE</string><key>HOME</key><string>$HOME</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$REPO/data/logs/bot.log</string>
  <key>StandardErrorPath</key><string>$REPO/data/logs/bot.err.log</string>
</dict>
</plist>
PLIST

cat > "$AGENTS/com.engbot.backup.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.engbot.backup</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$REPO/scripts/backup.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$REPO/data/logs/backup.log</string>
  <key>StandardErrorPath</key><string>$REPO/data/logs/backup.log</string>
</dict>
</plist>
PLIST

for label in com.engbot.bot com.engbot.backup; do
  plutil -lint "$AGENTS/$label.plist" > /dev/null
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
done
echo "Installed. Status: launchctl print $DOMAIN/com.engbot.bot | grep -E 'state|pid'"
echo "Logs: tail -f $REPO/data/logs/bot.log $REPO/data/logs/bot.err.log"
