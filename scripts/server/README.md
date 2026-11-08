# Сервер

Бот работает из `/opt/eng-bot-git`; `data/` и `.env` — ссылки на `/opt/eng-bot/`, вне Git. Для
Linux нужны Node.js 24, `ffmpeg`, `espeak-ng` и Python с Kokoro из `tools/tts/README.md`.
Распознавание речи не установлено.

После push в `main` GitHub Actions запускает тесты, typecheck и сборку Mini App. Таймер
`eng-bot-deploy.timer` раз в пять минут смотрит результат; прошедший коммит забирает через
`git fetch` и fast-forward merge, устанавливает зависимости, собирает Mini App и перезапускает сервис.

```bash
systemctl status eng-bot.service
journalctl -u eng-bot.service -n 50
systemctl status eng-bot-deploy.timer
systemctl status eng-bot-backup.timer
```

`eng-bot-backup.timer` ежедневно делает согласованную копию SQLite в `data/backups/` и хранит
последние 14. Копии находятся на том же диске; для защиты от потери сервера нужен внешний бэкап.
