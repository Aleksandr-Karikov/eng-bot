import type { Bot, InlineKeyboard } from "grammy";
import { State } from "ts-fsrs";
import { answerCard, getDueItemByCard, markKnown, nextDue, nextReviewAt } from "../../services/review";
import { getWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { rateKeyboard, showKeyboard } from "../keyboards";
import { cardFront, doneText, draftText } from "../texts";

/** Сколько карточек пользователь ответил в текущей сессии /learn (только для итогового сообщения). */
const sessionCounts = new Map<number, number>();

async function showNext(ctx: BotContext, deps: Deps, mode: "reply" | "edit"): Promise<void> {
  const item = await nextDue(deps.db, ctx.user.id, deps.now());
  let text: string;
  let replyMarkup: InlineKeyboard | undefined;
  if (item) {
    text = cardFront(item.word);
    replyMarkup = showKeyboard(item.card.id, item.card.reps);
  } else {
    const next = await nextReviewAt(deps.db, ctx.user.id);
    text = doneText(sessionCounts.get(ctx.user.id) ?? 0, next, ctx.user.timezone);
    sessionCounts.delete(ctx.user.id);
  }
  const options = { ...HTML, reply_markup: replyMarkup };
  if (mode === "edit") await ctx.editMessageText(text, options);
  else await ctx.reply(text, options);
}

async function startSession(ctx: BotContext, deps: Deps): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return void (await ctx.reply(`Учиться удобнее в личке: https://t.me/${deps.botUsername}`));
  }
  sessionCounts.set(ctx.user.id, 0);
  await showNext(ctx, deps, "reply");
}

export function registerLearn(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("learn", (ctx) => startSession(ctx, deps));

  bot.callbackQuery(/^l$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSession(ctx, deps);
  });

  bot.callbackQuery(/^s:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const item = cb?.k === "show" ? await getDueItemByCard(deps.db, ctx.user.id, cb.cardId) : undefined;
    if (cb?.k === "show" && !item) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (cb?.k !== "show" || !item || item.card.reps !== cb.reps) {
      return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(draftText(item.word), {
      ...HTML,
      reply_markup: rateKeyboard(item.card.id, item.card.reps, item.card.state === State.New, item.word.id),
    });
  });

  bot.callbackQuery(/^r:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "rate") return void (await ctx.answerCallbackQuery());
    const result = await answerCard(deps.db, {
      userId: ctx.user.id,
      cardId: cb.cardId,
      expectedReps: cb.reps,
      answer: cb.answer,
      now: deps.now(),
    });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery();
    sessionCounts.set(ctx.user.id, (sessionCounts.get(ctx.user.id) ?? 0) + 1);
    await showNext(ctx, deps, "edit");
  });

  bot.callbackQuery(/^k:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "know" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "know") return void (await ctx.answerCallbackQuery());
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (!cb.knows) {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`${draftText(word)}\n\n📚 Добавлено в изучение — встретится в /learn`, HTML));
    }
    const result = await markKnown(deps.db, { userId: ctx.user.id, wordId: word.id, now: deps.now() });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery({ text: "👍" });
    await ctx.editMessageText(`${draftText(word)}\n\n✅ Отмечено как известное — проверю через пару недель`, HTML);
  });
}
