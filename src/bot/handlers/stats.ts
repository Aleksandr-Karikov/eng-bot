import type { Bot } from "grammy";
import { getRoom } from "../../services/rooms";
import { personalStats, roomLeaderboard } from "../../services/stats";
import { toggleCardPart } from "../../services/card-view";
import { updateUser } from "../../services/users";
import { parseHHMM } from "../../time";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { settingsKeyboard } from "../keyboards";
import { settingsText, statsText } from "../texts";
import type { Stage } from "../../services/exercises";
import type { User } from "../../db/schema";

const MODE_FIELDS = {
  en_ru: "modeEnRu",
  ru_en: "modeRuEn",
  cloze: "modeCloze",
  sentence: "modeSentence",
  listen: "modeListen",
} as const satisfies Record<Stage, keyof User>;

export function registerStats(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("stats", async (ctx) => {
    const now = deps.now();
    const stats = await personalStats(deps.db, ctx.user, now);
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    const board = room ? await roomLeaderboard(deps.db, room.id, now) : undefined;
    await ctx.reply(statsText(stats, room?.name, board), HTML);
  });

  bot.command("settings", async (ctx) => {
    const arg = ctx.match.trim();
    if (arg) {
      const time = parseHHMM(arg);
      if (!time) return void (await ctx.reply("Формат времени: /settings 21:30"));
      await updateUser(deps.db, ctx.user.id, { reminderTime: time });
      return void (await ctx.reply(`⏰ Буду напоминать в ${time}`));
    }
    await ctx.reply(settingsText(ctx.user), { reply_markup: settingsKeyboard(ctx.user) });
  });

  bot.callbackQuery(/^cv:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "cardPart") return void (await ctx.answerCallbackQuery());
    const user = await updateUser(deps.db, ctx.user.id, { cardHidden: toggleCardPart(ctx.user.cardHidden, cb.part) });
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user) });
  });

  bot.callbackQuery(/^nd$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { notifyDue: !ctx.user.notifyDue });
    await ctx.answerCallbackQuery({ text: user.notifyDue ? "Буду сообщать" : "Не буду" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user) });
  });

  bot.callbackQuery(/^md$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { modeDrill: !ctx.user.modeDrill });
    await ctx.answerCallbackQuery({ text: user.modeDrill ? "Включено" : "Выключено" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user) });
  });

  bot.callbackQuery(/^m:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "mode") return void (await ctx.answerCallbackQuery());
    const field = MODE_FIELDS[cb.stage];
    const next = { [field]: !ctx.user[field] };
    if (!next[field] && Object.values(MODE_FIELDS).every((f) => f === field || !ctx.user[f])) {
      return void (await ctx.answerCallbackQuery({ text: "Хотя бы один режим должен остаться включённым" }));
    }
    const user = await updateUser(deps.db, ctx.user.id, next);
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user) });
  });

  bot.callbackQuery(/^t:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "hour") return void (await ctx.answerCallbackQuery());
    const time = `${String(cb.hour).padStart(2, "0")}:00`;
    const user = await updateUser(deps.db, ctx.user.id, { reminderTime: time });
    await ctx.answerCallbackQuery({ text: `Буду напоминать в ${time}` });
    await ctx.editMessageText(settingsText(user), { reply_markup: settingsKeyboard(user) });
  });
}
