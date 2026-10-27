import { currentLang, langForms } from "../../lang";
import { clearPendingInputs, endLongModes } from "../pending";
import type { Bot } from "grammy";
import type { TranslationReview } from "../../llm/tutor";
import { recordDrillAnswer, recordMistakes } from "../../services/mistakes";
import { answerCard, getDueItemByCard } from "../../services/review";
import { translationMaterial } from "../../services/translate";
import { background, HTML, type BotContext, type Deps } from "../context";
import { translateKeyboard, translatePauseKeyboard } from "../keyboards";
import { drillProgressText, esc, translateDoneText, translateResultText, translateTaskText } from "../texts";
import { RECENT_TASKS, type ActiveTask, type TranslateSession } from "../translations";
import { allowQuota } from "./quota";

async function makeTask(deps: Deps, userId: number, session: TranslateSession): Promise<ActiveTask | undefined> {
  const material = await translationMaterial(deps.db, userId, deps.now(), deps.random, session.recent);
  const task = await deps.tutor.translationTask(material);
  return { ...task, card: task.word ? material.cardByTerm.get(task.word.toLowerCase()) : undefined };
}

/** Следующее задание: заранее подготовленное или свежее; сразу начинаем готовить ещё одно. */
/** lead — короткий итог прошлого ответа («✅ Верно: …») в начале сообщения с новым заданием. */
async function sendNext(ctx: BotContext, deps: Deps, session: TranslateSession, lead?: string): Promise<void> {
  session.paused = false;
  await ctx.replyWithChatAction("typing").catch(() => {});
  let task: ActiveTask | undefined;
  session.preparing = true;
  try {
    task = (await session.next?.catch(() => undefined)) ?? (await makeTask(deps, ctx.user.id, session));
  } catch (err) {
    session.preparing = false;
    console.error("Translation task failed", err);
    // Без задания сессия только перехватывала бы личку («готовлю…») — закрываем.
    if (deps.translations.get(ctx.user.id) === session) deps.translations.end(ctx.user.id);
    return void (await ctx.reply("Не получилось придумать предложение 😔 Попробуй ещё раз — /translate"));
  }
  session.preparing = false;
  if (!task || deps.translations.get(ctx.user.id) !== session) return;
  session.task = task;
  session.recent = [...session.recent, task.ru].slice(-RECENT_TASKS);
  session.next = makeTask(deps, ctx.user.id, session).catch((err) => {
    console.error("Translation prefetch failed", err);
    return undefined;
  });
  const text = translateTaskText(task.ru);
  const sent = await ctx.reply(lead ? `${lead}\n\n${text}` : text, { ...HTML, reply_markup: translateKeyboard() });
  session.taskMessageId = sent.message_id;
}

/** Разбор, который стоит прочитать: следующее предложение — по «▶ Дальше», а не сразу под ним. */
async function pause(ctx: BotContext, session: TranslateSession, text: string): Promise<void> {
  session.paused = true;
  await ctx.reply(text, { ...HTML, reply_markup: translatePauseKeyboard() });
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
    return pause(ctx, session, `Не получилось проверить 😔 Можно так: <b>${esc(task.en)}</b>`);
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
  // Верно и без поправок — одной строкой в шапку следующего задания; иначе разбор ждёт «▶ Дальше».
  const quiet = review.correct && real.length === 0 && !review.natural && !progress?.resolved;
  if (!quiet) return pause(ctx, session, translateResultText(task, review, progress, real.length > 0));
  const used = task.word && review.usedWord ? `\n📚 <b>${esc(task.word)}</b> — засчитано как повторение` : "";
  const topic = progress ? `\n${drillProgressText(progress)}` : "";
  await sendNext(ctx, deps, session, `✅ Верно: <i>${esc(answer)}</i>${used}${topic}`);
}

export async function startTranslate(ctx: BotContext, deps: Deps): Promise<void> {
  if (!ctx.chat) return;
  if (ctx.chat.type !== "private") return void (await ctx.reply(`Тренажёр перевода — в личке: https://t.me/${deps.botUsername}`));
  // Считается тренировка целиком, а не перевод: внутри сессии заданий много, и они идут подряд.
  if (!(await allowQuota(ctx, deps, "translate"))) return;
  endLongModes(deps, ctx.user.id, "translate");
  clearPendingInputs(deps, ctx.user.id, ctx.chat.id);
  const session = deps.translations.start(ctx.user.id, ctx.chat.id);
  await ctx.reply(
    `🇷🇺 → ${currentLang().flag} <b>Тренажёр перевода</b>\n\nПереводи предложения на ${langForms().acc} и пиши ответ сообщением. Предложения — под твои частые ошибки и слова, которые ты сейчас учишь. ⏹ — закончить.`,
    HTML,
  );
  background(ctx, () => sendNext(ctx, deps, session));
}

export function registerTranslate(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("translate", (ctx) => startTranslate(ctx, deps));

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
    await pause(ctx, session, `🤷 Можно так:\n<b>${esc(task.en)}</b>`);
  });

  bot.callbackQuery(/^tn$/, async (ctx) => {
    const session = deps.translations.get(ctx.user.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    if (!session) return void (await ctx.reply("Тренировка уже закончилась — /translate"));
    if (!session.paused) return;
    background(ctx, () => sendNext(ctx, deps, session));
  });

  // Перевод — обычным сообщением в личке, пока идёт тренировка (раньше /add: иначе стал бы «новым словом»).
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const session = deps.translations.get(ctx.user.id);
    if (!session || text.startsWith("/") || session.chatId !== ctx.chat.id) return next();
    const task = session.task;
    // Задание ещё готовится — подождать; если и не готовится (что-то сломалось), не держать личку.
    if (!task && session.paused) return void (await ctx.reply("Нажми «▶ Дальше» под разбором — пришлю следующее предложение"));
    if (!task && (session.preparing || session.next)) return void (await ctx.reply("Секунду, готовлю следующее предложение…"));
    if (!task) return next();
    session.task = undefined;
    // Ответили — «🤷 Не знаю» и «⏹» у задания больше не нужны (⏹ есть и под разбором, и под следующим).
    if (session.taskMessageId !== undefined) void ctx.api.editMessageReplyMarkup(session.chatId, session.taskMessageId).catch(() => {});
    session.lastAt = Date.now();
    background(ctx, () => checkAnswer(ctx, deps, session, task, text));
  });
}
