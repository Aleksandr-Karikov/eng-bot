#!/bin/zsh
# Останавливает и удаляет LaunchAgent'ы бота и бэкапа.
set -euo pipefail
for label in com.engbot.bot com.engbot.backup; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "Uninstalled."
