import type { Bot } from "grammy";
import type { TranslationReview } from "../../llm/tutor";
import { recordDrillAnswer, recordMistakes } from "../../services/mistakes";
import { answerCard, getDueItemByCard } from "../../services/review";
import { translationMaterial } from "../../services/translate";
import { background, HTML, type BotContext, type Deps } from "../context";
import { translateKeyboard } from "../keyboards";
import { esc, translateDoneText, translateResultText, translateTaskText } from "../texts";
import { RECENT_TASKS, type ActiveTask, type TranslateSession } from "../translations";

async function makeTask(deps: Deps, userId: number, session: TranslateSession): Promise<ActiveTask | undefined> {
  const material = await translationMaterial(deps.db, userId, deps.now(), deps.random, session.recent);
  const task = await deps.tutor.translationTask(material);
  return { ...task, card: task.word ? material.cardByTerm.get(task.word.toLowerCase()) : undefined };
}

/** Следующее задание: заранее подготовленное или свежее; сразу начинаем готовить ещё одно. */
async function sendNext(ctx: BotContext, deps: Deps, session: TranslateSession): Promise<void> {
  await ctx.replyWithChatAction("typing").catch(() => {});
  let task: ActiveTask | undefined;
  try {
    task = (await session.next?.catch(() => undefined)) ?? (await makeTask(deps, ctx.user.id, session));
  } catch (err) {
    console.error("Translation task failed", err);
    session.next = undefined;
    return void (await ctx.reply("Не получилось придумать предложение 😔 Попробуй ещё раз — /translate"));
  }
  if (!task || deps.translations.get(ctx.user.id) !== session) return;
  session.task = task;
  session.recent = [...session.recent, task.ru].slice(-RECENT_TASKS);
  session.next = makeTask(deps, ctx.user.id, session).catch((err) => {
    console.error("Translation prefetch failed", err);
    return undefined;
  });
  await ctx.reply(translateTaskText(task.ru), { ...HTML, reply_markup: translateKeyboard() });
}

/**
 * Проверка перевода. Ошибки — сразу в работу над ошибками (это своя тренировка, без кнопки),
 * тема задания — в прогресс её закрытия, верно употреблённое слово — как повторение его карточки.
 */
async function checkAnswer(ctx: BotContext, deps: Deps, session: TranslateSession, task: ActiveTask, answer: string): Promise<void> {
  await ctx.replyWithChatAction("typing").catch(() => {});
  let review: TranslationReview;
  try {
    review = await deps.tutor.reviewTranslation({ task, answer });
  } catch (err) {
    console.error("Translation review failed", err);
    await ctx.reply(`Не получилось проверить 😔 Можно так: <b>${esc(task.en)}</b>`, HTML);
    return sendNext(ctx, deps, session);
  }
  session.done++;
  if (review.correct) session.correct++;
  const now = deps.now();
  const real = review.fixes.filter((f) => !f.slip);
  await recordMistakes(deps.db, ctx.user.id, real, now);
  const progress = task.topic
    ? await recordDrillAnswer(deps.db, ctx.user.id, task.topic, !real.some((f) => f.category?.toLowerCase() === task.topic.toLowerCase()), now)
    : undefined;
  if (task.card && review.usedWord) {
    const item = await getDueItemByCard(deps.db, ctx.user.id, task.card.cardId);
    if (item) await answerCard(deps.db, { userId: ctx.user.id, cardId: item.card.id, expectedReps: item.card.reps, answer: "good", now, stage: "translate" });
  }
  await ctx.reply(translateResultText(task, review, progress, real.length > 0), HTML);
  await sendNext(ctx, deps, session);
}

export function registerTranslate(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("translate", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Тренажёр перевода — в личке: https://t.me/${deps.botUsername}`));
    const session = deps.translations.start(ctx.user.id, ctx.chat.id);
    await ctx.reply(
      "🇷🇺 → 🇬🇧 <b>Тренажёр перевода</b>\n\nПереводи предложения на английский и пиши ответ сообщением. Предложения — под твои частые ошибки и слова, которые ты сейчас учишь. ⏹ — закончить.",
      HTML,
    );
    background(ctx, () => sendNext(ctx, deps, session));
  });

  bot.callbackQuery(/^tz$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    const session = deps.translations.end(ctx.user.id);
    await ctx.reply(translateDoneText(session?.done ?? 0, session?.correct ?? 0));
  });

  bot.callbackQuery(/^tu$/, async (ctx) => {
    const session = deps.translations.get(ctx.user.id);
    const task = session?.task;
    if (!session || !task) return void (await ctx.answerCallbackQuery({ text: "Тренировка уже закончилась — /translate" }));
    await ctx.answerCallbackQuery();
    session.task = undefined;
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(`🤷 Можно так:\n<b>${esc(task.en)}</b>`, HTML);
    background(ctx, () => sendNext(ctx, deps, session));
  });

  // Перевод — обычным сообщением в личке, пока идёт тренировка (раньше /add: иначе стал бы «новым словом»).
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const session = deps.translations.get(ctx.user.id);
    if (!session || text.startsWith("/") || session.chatId !== ctx.chat.id) return next();
    const task = session.task;
    if (!task) return void (await ctx.reply("Секунду, готовлю следующее предложение…"));
    session.task = undefined;
    session.lastAt = Date.now();
    background(ctx, () => checkAnswer(ctx, deps, session, task, text));
  });
}
