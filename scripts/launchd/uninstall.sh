#!/bin/zsh
# Останавливает и удаляет LaunchAgent'ы бота, бэкапа и ngrok.
set -euo pipefail
for label in com.engbot.bot com.engbot.backup com.engbot.ngrok; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "Uninstalled."
