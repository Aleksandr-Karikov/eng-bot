import type { Bot } from "grammy";
import { ignoreHarmlessErrors } from "./api-errors";
import type { BotContext, Deps } from "./context";
import { registerAdd } from "./handlers/add";
import { registerBatch } from "./handlers/batch";
import { registerCheck } from "./handlers/check";
import { registerDelete } from "./handlers/delete";
import { registerMistakes } from "./handlers/drill";
import { registerEdit } from "./handlers/edit";
import { registerLearn } from "./handlers/learn";
import { registerRooms } from "./handlers/rooms";
import { registerStats } from "./handlers/stats";
import { userMiddleware } from "./middleware";

export const COMMANDS = [
  { command: "learn", description: "Повторить слова" },
  { command: "add", description: "Добавить слово" },
  { command: "text", description: "Разобрать текст и добавить пачкой" },
  { command: "check", description: "Проверить английский (ответом на сообщение)" },
  { command: "drill", description: "Вопросы по твоим частым ошибкам" },
  { command: "mistakes", description: "Твои частые ошибки" },
  { command: "edit", description: "Исправить слово (можно по кусочку)" },
  { command: "delete", description: "Удалить слово (можно по кусочку)" },
  { command: "stats", description: "Прогресс твой и друзей" },
  { command: "room", description: "Комнаты и приглашения" },
  { command: "newroom", description: "Создать комнату" },
  { command: "settings", description: "Время напоминания" },
  { command: "link", description: "Привязать группу к комнате" },
];

export function setupBot(bot: Bot<BotContext>, deps: Deps): void {
  bot.api.config.use(ignoreHarmlessErrors);
  bot.use(userMiddleware(deps));
  registerRooms(bot, deps);
  registerLearn(bot, deps);
  registerStats(bot, deps);
  registerBatch(bot, deps);
  registerCheck(bot, deps);
  registerMistakes(bot, deps);
  registerDelete(bot, deps);
  registerEdit(bot, deps);
  registerAdd(bot, deps);
  // Неизвестные/устаревшие кнопки — просто гасим «часики».
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  bot.catch(async (err) => {
    console.error("Bot error", err.error);
    await err.ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
