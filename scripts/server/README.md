# Сервер

Полная конфигурация VPS, повторная установка, перенос данных и найденные проблемы —
`docs/server-runbook.md`.

Бот работает из `/opt/eng-bot-git`; `data/` и `.env` — ссылки на `/opt/eng-bot/`, вне Git. Для
Linux нужны Node.js 24, `ffmpeg`, `espeak-ng`, `zip` и Python с Kokoro из `tools/tts/README.md`.
Распознавание речи не установлено.

После push в `main` GitHub Actions запускает тесты, typecheck и сборку Mini App, затем по
ограниченному SSH-ключу запускает `eng-bot-deploy.service`. Сервис ещё раз проверяет CI для
текущего HEAD `main`, делает `git fetch` и fast-forward merge, устанавливает зависимости,
собирает Mini App и перезапускает бота. `eng-bot-deploy.timer` оставлен в репозитории как
резервный вариант, на сервере выключен.

```bash
systemctl status eng-bot.service
journalctl -u eng-bot.service -n 50
systemctl status eng-bot-deploy.service
systemctl status eng-bot-backup.timer
```

`eng-bot-backup.timer` ежедневно делает согласованную копию SQLite в `data/backups/` и хранит
последние 14. Копии находятся на том же диске; для защиты от потери сервера нужен внешний бэкап.

Mini App работает по `https://144.31.167.217/app/`. Сертификат для IP выпускает отдельный
Certbot в `/opt/certbot-ip`; он действует около шести дней. `eng-bot-cert-renew.timer` дважды в
день проверяет продление и перезагружает Nginx при обновлении сертификата.
