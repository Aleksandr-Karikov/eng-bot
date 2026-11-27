import type { Bot } from "grammy";
import { EN } from "../../lang";
import { bossEnabled, bossFeed, bossOf, buyUpgrade, coinState, personalDamage } from "../../services/boss";
import { findRoomByChat, getRoom } from "../../services/rooms";
import { goalProgress, setWeeklyGoal } from "../../services/goals";
import { roomTimeZone } from "../../services/digest";
import { personalStats, roomLeaderboard } from "../../services/stats";
import { toggleCardPart } from "../../services/card-view";
import { autoVoice, toggleVoiceAccent } from "../../services/voice";
import { MAX_LEARNING_LIMIT, setActiveLearningLimit, setNewPerDay, updateUser } from "../../services/users";
import { parseHHMM } from "../../time";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { bossKeyboard, settingsKeyboard } from "../keyboards";
import { bossHitsText, bossText, goalText, settingsText, statsText } from "../texts";
import type { Stage } from "../../services/exercises";
import type { User } from "../../db/schema";

const MODE_FIELDS = {
  en_ru: "modeEnRu",
  ru_en: "modeRuEn",
  cloze: "modeCloze",
  sentence: "modeSentence",
  listen: "modeListen",
  collocation: "modeCollocation",
} as const satisfies Record<Stage, keyof User>;

export function registerStats(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("stats", async (ctx) => {
    const now = deps.now();
    const stats = await personalStats(deps.db, ctx.user, now);
    // В группе — её комната (как /goal), в личке — текущая.
    const room =
      ctx.chat.type !== "private"
        ? (ctx.groupRoom ?? undefined)
        : ctx.user.currentRoomId != null
          ? await getRoom(deps.db, ctx.user.currentRoomId)
          : undefined;
    const board = room ? await roomLeaderboard(deps.db, room.id, now) : undefined;
    const goal = room ? await goalProgress(deps.db, room, now) : undefined;
    await ctx.reply(statsText(stats, room?.name, board, goal), HTML);
  });

  // Цель комнаты: в группе — привязанной, в личке — текущей.
  bot.command("goal", async (ctx) => {
    const room =
      ctx.chat.type !== "private"
        ? await findRoomByChat(deps.db, ctx.chat.id)
        : ctx.user.currentRoomId != null
          ? await getRoom(deps.db, ctx.user.currentRoomId)
          : undefined;
    if (!room) return void (await ctx.reply(ctx.chat.type !== "private" ? "Эта группа ещё не привязана к комнате — /link" : "Сначала создай комнату — /room"));
    const arg = ctx.match.trim().toLowerCase();
    if (arg) {
      const goal = arg === "auto" ? 0 : Number(arg);
      if (!Number.isInteger(goal) || goal < 0 || goal > 100_000) return void (await ctx.reply("Формат: /goal 600 — цель в HP на неделю, или /goal auto"));
      await setWeeklyGoal(deps.db, room.id, goal);
    }
    const fresh = (await getRoom(deps.db, room.id)) ?? room;
    await ctx.reply(goalText(fresh.name, await goalProgress(deps.db, fresh, deps.now()), roomTimeZone(fresh)), HTML);
  });

  /**
   * 🐉 /boss — босс недели своими словами: HP, темп, кто сколько снял и кнопка ленты ударов.
   * Тот же расчёт, что /goal, поэтому режим ничего не «зарабатывает» и не может разойтись с целью.
   */
  bot.command("boss", async (ctx) => {
    // Рубильник выключен — режима нет ни у кого, и /boss честно об этом говорит вместо пустого боя.
    if (deps.bossEnabled === false) return void (await ctx.reply("🐉 Босс сейчас выключен целиком. Включить — BOSS_ENABLED=1 в .env и перезапуск."));
    const room =
      ctx.chat.type !== "private"
        ? await findRoomByChat(deps.db, ctx.chat.id)
        : ctx.user.currentRoomId != null
          ? await getRoom(deps.db, ctx.user.currentRoomId)
          : undefined;
    if (!room) return void (await ctx.reply(ctx.chat.type !== "private" ? "Эта группа ещё не привязана к комнате — /link" : "Сначала создай комнату — /room"));
    // Выключенный режим — не прячем команду совсем: говорим, где включить, и всё равно показываем бой.
    const boss = await bossOf(deps.db, room, deps.now());
    const feed = await bossFeed(deps.db, room, deps.now(), 3);
    const own = bossEnabled(ctx.user, deps.bossEnabled);
    const hint = own ? "" : "\n\n<i>Режим выключен в /settings → 🎯 Упражнения. Включи, чтобы босс был и в приложении.</i>";
    await ctx.reply(bossText(boss, feed) + hint, { ...HTML, reply_markup: bossKeyboard(own) });
  });

  /** 🪙 /upgrade — купить усиление из бота, не открывая приложение. */
  bot.command("upgrade", async (ctx) => {
    if (deps.bossEnabled === false) return void (await ctx.reply("🐉 Босс сейчас выключен целиком. Включить — BOSS_ENABLED=1 в .env и перезапуск."));
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) return void (await ctx.reply("Сначала создай комнату — /room"));
    const now = deps.now();
    const state = coinState(await personalDamage(deps.db, ctx.user.id, now), ctx.user, now);
    if (state.price === null) return void (await ctx.reply(`⚔️ Усиление уже максимальное: +${state.level * 10}% к урону.`));
    if (state.coins < state.price) {
      return void (await ctx.reply(
        `🪙 Монет на этой неделе: ${state.coins}, а следующий уровень стоит ${state.price}.\nКарточки дают энергию. За урон в бою с боссом начисляются монеты.`,
      ));
    }
    const result = await buyUpgrade(deps.db, ctx.user.id, await personalDamage(deps.db, ctx.user.id, now), now);
    if (result !== "ok") return void (await ctx.reply("Покупка не прошла. Проверь баланс и попробуй ещё раз."));
    await ctx.reply(`⚔️ Куплено! Усиление +${(state.level + 1) * 10}% к урону. Монеты недели сгорают в воскресенье — трать до конца недели.`);
  });

  bot.callbackQuery(/^bh$/, async (ctx) => {
    const room =
      ctx.chat?.type === "private"
        ? ctx.user.currentRoomId != null
          ? await getRoom(deps.db, ctx.user.currentRoomId)
          : undefined
        : ctx.chat
          ? await findRoomByChat(deps.db, ctx.chat.id)
          : undefined;
    if (!room) return void (await ctx.answerCallbackQuery({ text: "Нет комнаты" }));
    const feed = await bossFeed(deps.db, room, deps.now(), 10);
    await ctx.answerCallbackQuery();
    await ctx.reply(bossHitsText(feed.hits, ctx.user.timezone), HTML);
  });

  bot.command("settings", async (ctx) => {
    const arg = ctx.match.trim();
    const [screen, size, extra] = arg.split(/\s+/);
    if (screen === "new" || screen === "active") {
      const value = size && !extra && /^\d+$/.test(size) ? Number(size) : NaN;
      const setLimit = screen === "new" ? setNewPerDay : setActiveLearningLimit;
      const user = await setLimit(deps.db, ctx.user.id, value);
      const screenOptions = { ...HTML, reply_markup: settingsKeyboard(user ?? ctx.user, screen) };
      if (!user) return void (await ctx.reply(`Для /settings ${screen} введи целое число от ${screen === "new" ? 0 : 1} до ${MAX_LEARNING_LIMIT}.`, screenOptions));
      return void (await ctx.reply(settingsText(user, screen), screenOptions));
    }
    if (arg) {
      const time = parseHHMM(arg);
      if (!time) return void (await ctx.reply("Формат времени: /settings 21:30"));
      await updateUser(deps.db, ctx.user.id, { reminderTime: time });
      return void (await ctx.reply(`⏰ Буду напоминать в ${time}`));
    }
    await ctx.reply(settingsText(ctx.user), { ...HTML, reply_markup: settingsKeyboard(ctx.user) });
  });

  bot.callbackQuery(/^cv:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "cardPart") return void (await ctx.answerCallbackQuery());
    const user = await updateUser(deps.db, ctx.user.id, { cardHidden: toggleCardPart(ctx.user.cardHidden, cb.part) });
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "card") });
  });

  bot.callbackQuery(/^nd$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { notifyDue: !ctx.user.notifyDue });
    await ctx.answerCallbackQuery({ text: user.notifyDue ? "Буду сообщать" : "Не буду" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "remind") });
  });

  bot.callbackQuery(/^wr$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { weeklyReport: !ctx.user.weeklyReport });
    await ctx.answerCallbackQuery({ text: user.weeklyReport ? "Буду присылать" : "Не буду" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "remind") });
  });

  bot.callbackQuery(/^md$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { modeDrill: !ctx.user.modeDrill });
    await ctx.answerCallbackQuery({ text: user.modeDrill ? "Включено" : "Выключено" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "modes") });
  });

  // 🐉 Босс недели — такой же личный режим, как вопросы по ошибкам: выключил, и остаются обычные числа.
  bot.callbackQuery(/^bm$/, async (ctx) => {
    const user = await updateUser(deps.db, ctx.user.id, { modeBoss: !ctx.user.modeBoss });
    await ctx.answerCallbackQuery({ text: user.modeBoss ? "Босс включён" : "Босс выключен" });
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "modes") });
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
    await ctx.editMessageReplyMarkup({ reply_markup: settingsKeyboard(user, "modes") });
  });

  bot.callbackQuery(/^t:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "hour") return void (await ctx.answerCallbackQuery());
    const time = `${String(cb.hour).padStart(2, "0")}:00`;
    const user = await updateUser(deps.db, ctx.user.id, { reminderTime: time });
    await ctx.answerCallbackQuery({ text: `Буду напоминать в ${time}` });
    await ctx.editMessageText(settingsText(user, "remind"), { ...HTML, reply_markup: settingsKeyboard(user, "remind") });
  });

  bot.callbackQuery(/^vo:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "voice") return void (await ctx.answerCallbackQuery());
    const user = await updateUser(deps.db, ctx.user.id, { voiceAccent: toggleVoiceAccent(ctx.user.voiceAccent, cb.accent) });
    const accent = autoVoice(user);
    await ctx.answerCallbackQuery({ text: accent ? `Буду включать ${EN.accentLabel[accent]}` : "Озвучка карточек выключена" });
    await ctx.editMessageText(settingsText(user, "voice"), { ...HTML, reply_markup: settingsKeyboard(user, "voice") });
  });

  bot.callbackQuery(/^np:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "newPerDay") return void (await ctx.answerCallbackQuery());
    const user = await setNewPerDay(deps.db, ctx.user.id, cb.value);
    if (!user) return void (await ctx.answerCallbackQuery({ text: "Число вне допустимого диапазона" }));
    await ctx.answerCallbackQuery({ text: cb.value === 0 ? "Без ограничения" : `${cb.value} в день` });
    await ctx.editMessageText(settingsText(user, "new"), { ...HTML, reply_markup: settingsKeyboard(user, "new") });
  });

  bot.callbackQuery(/^al:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "activeLearningLimit") return void (await ctx.answerCallbackQuery());
    const user = await setActiveLearningLimit(deps.db, ctx.user.id, cb.value);
    if (!user) return void (await ctx.answerCallbackQuery({ text: "Нет такого варианта" }));
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageText(settingsText(user, "active"), { ...HTML, reply_markup: settingsKeyboard(user, "active") });
  });

  bot.callbackQuery(/^ss:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "settingsScreen") return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(settingsText(ctx.user, cb.screen), { ...HTML, reply_markup: settingsKeyboard(ctx.user, cb.screen) });
  });
}
