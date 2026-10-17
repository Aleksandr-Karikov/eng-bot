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

## Картинки-ассоциации (локальный FLUX)

Кнопка «💡 Запоминалка» на карточках → под запоминалкой «🖼 Нарисовать»: Claude описывает сцену, локальный
FLUX.1-schnell рисует её (~20 с, пик памяти ~12 ГБ, по одной картинке за раз), картинка кэшируется на слово.

1. Поставить генератор: `tools/imagegen/README.md` (окружение `tools/imagegen/.venv` с `mflux` и `pillow<13`).
2. В `.env`: `IMAGES_ENABLED=1` (путь к генератору — `MFLUX_BIN`, по умолчанию `tools/imagegen/.venv/bin/mflux-generate`).
3. `scripts/launchd/restart.sh`. Выключить — `IMAGES_ENABLED=0` и перезапуск: кнопка «🖼» пропадёт, остальное работает.

## Статистика

`npx tsx scripts/stats.ts` — сводка за 30 дней (только чтение): «Забыл» по ступеням, забывание новых слов
при первом показе, трудные слова, активность по людям, частые темы ошибок /check.

## Разработка

- `npm test` — тесты (SQLite in-memory)
- `npm run typecheck`
- `npm run db:generate` — после изменения `src/db/schema.ts`

База лежит в `data/eng-bot.sqlite` (бэкап = копия файла).
