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
import { registerPronounce } from "./handlers/pronounce";
import { registerTranslate } from "./handlers/translate";
import { registerSay } from "./handlers/say";
import { registerExtension } from "./handlers/extension";
import { registerBug } from "./handlers/bug";
import { registerLesson } from "./handlers/lesson";
import { registerLlm } from "./handlers/llm";
import { registerStatus } from "./handlers/status";
import { registerInline } from "./handlers/inline";
import { buttonsText } from "./transcript";
import { userMiddleware } from "./middleware";
import { clearPendingInputs } from "./pending";

/** Порог, после которого обработка нажатия или вызов Telegram пишется в лог как медленный. */
const SLOW_MS = 2000;

/** Меню в личке — только главное; остальные команды работают и перечислены в /help. */
export const COMMANDS = [
  { command: "learn", description: "Повторить слова" },
  { command: "app", description: "Карточки в приложении (свайпы)" },
  { command: "add", description: "Добавить слово" },
  { command: "check", description: "Проверить английский (ответом на сообщение)" },
  { command: "mistakes", description: "Работа над ошибками" },
  { command: "translate", description: "Тренажёр перевода с русского" },
  { command: "talk", description: "Поговорить по-английски с разбором" },
  { command: "pron", description: "Проверить произношение голосовым" },
  { command: "stats", description: "Прогресс твой и друзей" },
  { command: "sets", description: "Готовые наборы слов по уровням и темам" },
  { command: "lang", description: "Язык: английский или корейский" },
  { command: "settings", description: "Настройки" },
  { command: "bug", description: "Сообщить об ошибке" },
  { command: "status", description: "Чем бот работает (только админ)" },
  { command: "help", description: "Что умеет бот" },
];

/** Меню в группах — то, что там имеет смысл. */
export const GROUP_COMMANDS = [
  { command: "check", description: "Проверить английский (ответом на сообщение)" },
  { command: "add", description: "Добавить слово" },
  { command: "duel", description: "Дуэль: кто быстрее переведёт" },
  { command: "story", description: "История из слов комнаты" },
  { command: "goal", description: "Цель комнаты на неделю" },
  { command: "link", description: "Комната группы и её язык" },
  { command: "bug", description: "Сообщить об ошибке" },
  { command: "help", description: "Что умеет бот" },
];

export function setupBot(bot: Bot<BotContext>, deps: Deps): void {
  bot.api.config.use(retryNetworkErrors());
  // Что бот отправил и показал (с кнопками) — для /bug.
  bot.api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    const p = payload as { chat_id?: unknown; text?: string; caption?: string; reply_markup?: unknown };
    const chatId = typeof p.chat_id === "number" ? p.chat_id : undefined;
    const text = p.text ?? p.caption;
    if (res.ok && chatId !== undefined && text && /^(send|edit)/.test(method)) {
      deps.transcript.record(chatId, { from: "bot", text: `${method === "sendMessage" || method === "sendPhoto" ? "" : `(${method}) `}${text}${buttonsText(p.reply_markup)}` });
    }
    return res;
  });
  bot.api.config.use(ignoreHarmlessErrors);
  bot.api.config.use(slowApiCallLogger(SLOW_MS));
  bot.use(async (ctx, next) => {
    const started = Date.now();
    await next();
    const ms = Date.now() - started;
    // Без текста сообщений: в лог попадали начала личной переписки. Команда или кнопка — достаточно.
    const what = ctx.callbackQuery?.data ?? (ctx.message?.text?.startsWith("/") ? ctx.message.text.split(/\s/)[0] : ctx.message ? "message" : "other");
    if (ms > SLOW_MS) console.warn(`Slow update (${ms} ms): ${what}`);
  });
  bot.use(userMiddleware(deps));
  // Что писал и нажимал человек — для /bug.
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId !== undefined) {
      const text = ctx.message?.text ?? ctx.message?.caption ?? (ctx.callbackQuery?.data ? `[нажал кнопку ${ctx.callbackQuery.data}]` : "");
      if (text) deps.transcript.record(chatId, { from: "user", name: ctx.from?.first_name, text });
    }
    await next();
  });
  // Любая команда отменяет брошенные «пришли ответом» — чтобы следующий текст не ушёл не туда.
  bot.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/")) clearPendingInputs(deps, ctx.user.id, ctx.chat?.id);
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
  registerTranslate(bot, deps);
  registerTalk(bot, deps);
  registerPronounce(bot, deps);
  registerSay(bot, deps);
  registerBug(bot, deps);
  registerLesson(bot, deps);
  registerLlm(bot, deps);
  registerStatus(bot, deps);
  registerExtension(bot, deps);
  registerAdd(bot, deps);
  registerInline(bot, deps);
  // Неизвестные/устаревшие кнопки — просто гасим «часики».
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  bot.catch(async (err) => {
    console.error("Bot error", err.error);
    await err.ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
