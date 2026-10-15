import type { Bot } from "grammy";
import type { BotContext, Deps } from "./context";
import { registerAdd } from "./handlers/add";
import { registerLearn } from "./handlers/learn";
import { registerRooms } from "./handlers/rooms";
import { userMiddleware } from "./middleware";

export const COMMANDS = [
  { command: "learn", description: "Повторить слова" },
  { command: "add", description: "Добавить слово" },
  { command: "stats", description: "Прогресс твой и друзей" },
  { command: "room", description: "Комнаты и приглашения" },
  { command: "newroom", description: "Создать комнату" },
  { command: "settings", description: "Время напоминания" },
  { command: "link", description: "Привязать группу к комнате" },
];

export function setupBot(bot: Bot<BotContext>, deps: Deps): void {
  bot.use(userMiddleware(deps));
  registerRooms(bot, deps);
  registerLearn(bot, deps);
  registerAdd(bot, deps);
  // Неизвестные/устаревшие кнопки — просто гасим «часики».
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  bot.catch(async (err) => {
    console.error("Bot error", err.error);
    await err.ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
