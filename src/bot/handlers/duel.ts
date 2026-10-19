import type { Api, Bot } from "grammy";
import { buildDuelRound, recordDuelPoint } from "../../services/duels";
import { findRoomByChat } from "../../services/rooms";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { DUEL_ROUNDS, type Duel } from "../duels";
import { duelKeyboard } from "../keyboards";
import { duelResultText, duelRoundText, esc } from "../texts";

let roundSeq = 0;

async function finishDuel(api: Api, deps: Deps, chatId: number, duel: Duel): Promise<void> {
  deps.duels.finish(chatId);
  const scores = [...duel.scores.values()].sort((a, b) => b.points - a.points);
  await api.sendMessage(chatId, duelResultText(scores), HTML).catch((err) => console.error("Duel result failed", err));
}

/** Следующий раунд или итоги. Таймер раунда сам переходит дальше, если никто не угадал. */
async function nextRound(api: Api, deps: Deps, chatId: number, duel: Duel): Promise<void> {
  if (duel.timer) clearTimeout(duel.timer);
  if (duel.round >= DUEL_ROUNDS) return finishDuel(api, deps, chatId, duel);
  const round = await buildDuelRound(deps.db, duel.roomId, Math.random);
  if (!round) return finishDuel(api, deps, chatId, duel);
  duel.round++;
  duel.roundId = ++roundSeq;
  duel.current = round;
  duel.lockedOut = new Set();
  let message;
  try {
    message = await api.sendMessage(chatId, duelRoundText(duel.round, DUEL_ROUNDS, round.term), {
      ...HTML,
      reply_markup: duelKeyboard(duel.roundId, round.options),
    });
  } catch (err) {
    // Раунд не ушёл (бота убрали из группы, сеть) — заканчиваем, иначе /duel навсегда «уже идёт».
    console.error("Duel round failed", chatId, err);
    deps.duels.finish(chatId);
    return;
  }
  duel.messageId = message.message_id;
  const roundId = duel.roundId;
  duel.timer = setTimeout(() => {
    // Раунд мог уже закончиться правильным ответом.
    if (deps.duels.get(chatId) !== duel || duel.roundId !== roundId || !duel.current) return;
    const answer = duel.current.options[duel.current.correct];
    const term = duel.current.term;
    duel.current = undefined;
    void api
      .editMessageText(chatId, message.message_id, `⏱ Никто не угадал: <b>${esc(term)}</b> — ${esc(answer)}`, HTML)
      .catch(() => {})
      .then(() => nextRound(api, deps, chatId, duel))
      .catch((err) => console.error("Duel round failed", err));
  }, deps.duels.roundMs);
}

export function registerDuel(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("duel", async (ctx) => {
    if (ctx.chat.type === "private") return void (await ctx.reply("Дуэль — для группы: отправь /duel в привязанном чате"));
    const room = await findRoomByChat(deps.db, ctx.chat.id);
    if (!room) return void (await ctx.reply("Эта группа ещё не привязана к комнате — отправь /link"));
    if (deps.duels.get(ctx.chat.id)) return void (await ctx.reply("⚔️ Дуэль уже идёт — отвечай на текущий раунд!"));
    if (!(await buildDuelRound(deps.db, room.id, Math.random))) {
      return void (await ctx.reply("Для дуэли нужно хотя бы 4 слова с разными переводами в комнате — добавьте через /add"));
    }
    const duel = deps.duels.start(ctx.chat.id, room.id);
    await ctx.reply(`⚔️ <b>Дуэль!</b> ${DUEL_ROUNDS} раундов: кто первым выберет правильный перевод — получает очко.`, HTML);
    await nextRound(ctx.api, deps, ctx.chat.id, duel);
  });

  bot.callbackQuery(/^dv:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const chatId = ctx.chat?.id;
    const duel = chatId !== undefined ? deps.duels.get(chatId) : undefined;
    if (cb?.k !== "duel" || chatId === undefined || !duel || !duel.current || cb.roundId !== duel.roundId) {
      return void (await ctx.answerCallbackQuery({ text: "Этот раунд уже закончился" }));
    }
    if (duel.lockedOut.has(ctx.user.id)) return void (await ctx.answerCallbackQuery({ text: "Ты уже отвечал в этом раунде" }));
    if (cb.index !== duel.current.correct) {
      duel.lockedOut.add(ctx.user.id);
      return void (await ctx.answerCallbackQuery({ text: "❌ Мимо — в этом раунде больше нельзя" }));
    }
    const round = duel.current;
    duel.current = undefined;
    if (duel.timer) clearTimeout(duel.timer);
    await recordDuelPoint(deps.db, duel.roomId, ctx.user.id, deps.now());
    const score = duel.scores.get(ctx.user.id) ?? { name: ctx.user.firstName, points: 0 };
    score.points++;
    duel.scores.set(ctx.user.id, score);
    void ctx.answerCallbackQuery({ text: "✅ Очко твоё!" }).catch(() => {});
    await ctx.editMessageText(
      `✅ <b>${esc(ctx.user.firstName)}</b> первым ответил(а): <b>${esc(round.term)}</b> — ${esc(round.options[round.correct])}`,
      HTML,
    );
    await nextRound(ctx.api, deps, chatId, duel);
  });
}
