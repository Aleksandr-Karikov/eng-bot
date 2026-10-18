import type { Bot } from "grammy";
import { ignoreHarmlessErrors, retryNetworkErrors, slowApiCallLogger } from "./api-errors";
import type { BotContext, Deps } from "./context";
import { registerAdd } from "./handlers/add";
import { registerAudio } from "./handlers/audio";
import { registerBatch } from "./handlers/batch";
import { registerCheck } from "./handlers/check";
import { registerDelete } from "./handlers/delete";
import { registerDuel } from "./handlers/duel";
import { registerMistakes } from "./handlers/drill";
import { registerMnemonic } from "./handlers/mnemonic";
import { registerEdit } from "./handlers/edit";
import { registerLearn } from "./handlers/learn";
import { registerRooms } from "./handlers/rooms";
import { registerStats } from "./handlers/stats";
import { registerStory } from "./handlers/story";
import { registerSpotted } from "./handlers/spotted";
import { registerTalk } from "./handlers/talk";
import { registerSay } from "./handlers/say";
import { userMiddleware } from "./middleware";
import { clearPendingInputs } from "./pending";

/** Порог, после которого обработка нажатия или вызов Telegram пишется в лог как медленный. */
const SLOW_MS = 2000;

export const COMMANDS = [
  { command: "learn", description: "Повторить слова" },
  { command: "add", description: "Добавить слово" },
  { command: "text", description: "Разобрать текст и добавить пачкой" },
  { command: "check", description: "Проверить английский (ответом на сообщение)" },
  { command: "drill", description: "Вопросы по твоим частым ошибкам" },
  { command: "mistakes", description: "Твои частые ошибки" },
  { command: "edit", description: "Исправить слово (можно по кусочку)" },
  { command: "delete", description: "Удалить слово (можно по кусочку)" },
  { command: "story", description: "История из слов комнаты" },
  { command: "talk", description: "Поговорить по-английски с разбором" },
  { command: "say", description: "Как сказать это по-английски" },
  { command: "duel", description: "Дуэль в группе: кто быстрее переведёт" },
  { command: "stats", description: "Прогресс твой и друзей" },
  { command: "goal", description: "Цель комнаты на неделю" },
  { command: "room", description: "Комнаты и приглашения" },
  { command: "newroom", description: "Создать комнату" },
  { command: "settings", description: "Время напоминания" },
  { command: "link", description: "Привязать группу к комнате" },
];

export function setupBot(bot: Bot<BotContext>, deps: Deps): void {
  bot.api.config.use(retryNetworkErrors());
  bot.api.config.use(ignoreHarmlessErrors);
  bot.api.config.use(slowApiCallLogger(SLOW_MS));
  bot.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    const ms = Date.now() - started;
    if (ms > SLOW_MS) console.warn(`Slow update (${ms} ms): ${ctx.callbackQuery?.data ?? ctx.message?.text?.slice(0, 40) ?? "other"}`);
  });
  bot.use(userMiddleware(deps));
  // Любая команда отменяет брошенные «пришли ответом» — чтобы следующий текст не ушёл не туда.
  bot.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/")) clearPendingInputs(deps, ctx.user.id);
    await next();
  });
  registerSpotted(bot, deps);
  registerRooms(bot, deps);
  registerAudio(bot, deps);
  registerMnemonic(bot, deps);
  registerLearn(bot, deps);
  registerStats(bot, deps);
  registerBatch(bot, deps);
  registerCheck(bot, deps);
  registerMistakes(bot, deps);
  registerDelete(bot, deps);
  registerDuel(bot, deps);
  registerStory(bot, deps);
  registerEdit(bot, deps);
  registerTalk(bot, deps);
  registerSay(bot, deps);
  registerAdd(bot, deps);
  // Неизвестные/устаревшие кнопки — просто гасим «часики».
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  bot.catch(async (err) => {
    console.error("Bot error", err.error);
    await err.ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
