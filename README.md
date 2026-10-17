# eng-bot

Telegram-бот для совместного заучивания английских слов с друзьями.

## Запуск

1. Node.js ≥ 20.12.
2. Залогиниться в Claude Code на этой машине (`claude`): бот берёт переводы через Claude Agent SDK, API-ключ не нужен.
3. Создать бота у @BotFather, скопировать `.env.example` в `.env` и вписать `BOT_TOKEN`.
   Privacy mode в группах можно оставить включённым — бот работает через команды и ответы на свои сообщения.
4. `npm install`
5. `npm start` (или `caffeinate -i npm start`, чтобы мак не засыпал).

Проверить подсказки отдельно: `npx tsx scripts/try-enrich.ts serendipity`.

## Постоянная работа на маке (launchd)

```bash
scripts/launchd/install.sh     # бот стартует при входе в систему и сам перезапускается при падении,
                               # мак не засыпает, пока бот работает; бэкап базы каждый день в 04:00
scripts/launchd/restart.sh     # перезапуск после обновления кода
scripts/launchd/uninstall.sh   # убрать автозапуск
tail -f data/logs/bot.log data/logs/bot.err.log
```

Не запускай `npm start` параллельно с launchd — будет ошибка 409 (два экземпляра бота).
Бэкапы: `data/backups/` (14 последних), вручную — `scripts/backup.sh`.
Восстановить: остановить бота (`uninstall.sh`), скопировать нужный бэкап в `data/eng-bot.sqlite`, снова `install.sh`.

## Разработка

- `npm test` — тесты (SQLite in-memory)
- `npm run typecheck`
- `npm run db:generate` — после изменения `src/db/schema.ts`

База лежит в `data/eng-bot.sqlite` (бэкап = копия файла).
