import { Bot } from "grammy";
import { setupBot, COMMANDS } from "./bot/setup";
import type { BotContext } from "./bot/context";
import { BatchStore } from "./bot/batches";
import { DraftStore } from "./bot/drafts";
import { PickerStore } from "./bot/pickers";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { ClaudeCodeEnricher } from "./llm/claude-code";
import { Notifier } from "./notifier";
import { startReminderLoop } from "./reminder-loop";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен — переменные можно передать окружением.
}

const config = loadConfig();
const db = createDb(config.dbPath);
const bot = new Bot<BotContext>(config.botToken);
const notifier = new Notifier(
  { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as Parameters<typeof bot.api.sendMessage>[2]) },
  db,
);
const now = () => new Date();

await bot.init();
setupBot(bot, {
  db,
  notifier,
  now,
  enricher: new ClaudeCodeEnricher({ model: config.enrichModel, timeoutMs: config.enrichTimeoutMs }),
  drafts: new DraftStore(),
  batches: new BatchStore(),
  pickers: new PickerStore(),
  botUsername: bot.botInfo.username,
});
await bot.api.setMyCommands(COMMANDS);

const stopReminders = startReminderLoop({ db, notifier, now });

const shutdown = () => {
  stopReminders();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`@${bot.botInfo.username} started`);
await bot.start();
