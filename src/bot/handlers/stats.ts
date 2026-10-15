import type { Bot } from "grammy";
import { getRoom } from "../../services/rooms";
import { personalStats, roomLeaderboard } from "../../services/stats";
import { updateUser } from "../../services/users";
import { parseHHMM } from "../../time";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { hoursKeyboard } from "../keyboards";
import { statsText } from "../texts";

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
    await ctx.reply(
      `⏰ Сейчас напоминаю в ${ctx.user.reminderTime} (${ctx.user.timezone}).\nВыбери час или отправь /settings ЧЧ:ММ`,
      { reply_markup: hoursKeyboard() },
    );
  });

  bot.callbackQuery(/^t:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "hour") return void (await ctx.answerCallbackQuery());
    const time = `${String(cb.hour).padStart(2, "0")}:00`;
    await updateUser(deps.db, ctx.user.id, { reminderTime: time });
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageText(`⏰ Буду напоминать в ${time}`);
  });
}
