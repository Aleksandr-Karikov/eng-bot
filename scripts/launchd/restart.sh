#!/bin/zsh
# Перезапуск бота после обновления кода.
launchctl kickstart -k "gui/$(id -u)/com.engbot.bot" && echo "Restarted."
