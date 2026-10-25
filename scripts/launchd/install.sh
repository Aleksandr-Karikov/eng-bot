#!/bin/zsh
# Ставит два LaunchAgent'а текущего пользователя:
#   com.engbot.bot    — бот: старт при входе в систему, перезапуск при падении, мак не засыпает, пока бот работает;
#   com.engbot.backup — бэкап базы каждый день в 04:00 (если мак спал — сразу после пробуждения);
#   com.engbot.ngrok  — туннель ngrok к Mini App (и /ext для расширения), если ngrok установлен.
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

LABELS=(com.engbot.bot com.engbot.backup)
NGROK=$(command -v ngrok || true)
# Постоянный адрес туннеля — из APP_URL в .env (бесплатный домен ngrok), иначе ngrok выдаст случайный.
NGROK_URL=$(grep -E '^APP_URL=https://[^/]*ngrok' "$REPO/.env" 2>/dev/null | sed -E 's|^APP_URL=(https://[^/]+).*|\1|' || true)
NGROK_ARGS="<string>http</string><string>8788</string>"
[ -n "$NGROK_URL" ] && NGROK_ARGS="$NGROK_ARGS<string>--url</string><string>$NGROK_URL</string>"
# Общий домен с другими приложениями (например, /money/ → money-bot): эндпоинты и правила — в data/ngrok-endpoints.yml.
NGROK_ENDPOINTS="$REPO/data/ngrok-endpoints.yml"
if [ -f "$NGROK_ENDPOINTS" ]; then
  NGROK_ARGS="<string>start</string><string>--all</string><string>--config</string><string>$HOME/Library/Application Support/ngrok/ngrok.yml</string><string>--config</string><string>$NGROK_ENDPOINTS</string>"
fi
if [ -n "$NGROK" ]; then
  LABELS+=(com.engbot.ngrok)
  cat > "$AGENTS/com.engbot.ngrok.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.engbot.ngrok</string>
  <key>ProgramArguments</key>
  <array><string>$NGROK</string>$NGROK_ARGS<string>--log</string><string>stdout</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>$HOME</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$REPO/data/logs/ngrok.log</string>
  <key>StandardErrorPath</key><string>$REPO/data/logs/ngrok.log</string>
</dict>
</plist>
PLIST
fi

for label in $LABELS; do
  plutil -lint "$AGENTS/$label.plist" > /dev/null
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  # Сразу после bootout launchd ещё выгружает старый процесс и отвечает «Input/output error» — повторяем.
  for attempt in $(seq 1 30); do
    launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist" 2>/dev/null && break
    [ $attempt = 30 ] && { echo "Не удалось запустить $label"; exit 1; }
    sleep 1
  done
done
echo "Installed. Status: launchctl print $DOMAIN/com.engbot.bot | grep -E 'state|pid'"
echo "Logs: tail -f $REPO/data/logs/bot.log $REPO/data/logs/bot.err.log"
