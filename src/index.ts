import { Bot } from "grammy";
import { setupBot, COMMANDS } from "./bot/setup";
import type { BotContext } from "./bot/context";
import { DraftStore } from "./bot/drafts";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { ClaudeCodeEnricher } from "./llm/claude-code";
import { Notifier } from "./notifier";

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
  botUsername: bot.botInfo.username,
});
await bot.api.setMyCommands(COMMANDS);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

console.log(`@${bot.botInfo.username} started`);
await bot.start();
