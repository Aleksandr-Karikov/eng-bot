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

## Разработка

- `npm test` — тесты (SQLite in-memory)
- `npm run typecheck`
- `npm run db:generate` — после изменения `src/db/schema.ts`

База лежит в `data/eng-bot.sqlite` (бэкап = копия файла).
