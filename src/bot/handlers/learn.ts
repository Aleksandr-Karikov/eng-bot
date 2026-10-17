import type { Bot, InlineKeyboard } from "grammy";
import { State } from "ts-fsrs";
import type { Judgement } from "../../llm/tutor";
import { listCloze, pickCloze } from "../../services/cloze";
import { chooseStage, isExactAnswer, targetStage } from "../../services/exercises";
import { answerCard, getDueItemByCard, markKnown, nextDue, nextReviewAt } from "../../services/review";
import { getWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { PendingCloze } from "../exercises";
import { clearPendingInputs } from "../pending";
import { ensureDrill, prefetchDrill, prepareDrill, present, sendDrillQuestion, type PresentMode } from "./drill";
import { audioKeyboard, clozeKeyboard, rateKeyboard } from "../keyboards";
import {
  cardText,
  clozeCorrectText,
  clozeFull,
  clozeJudgedText,
  clozeText,
  clozeUnknownText,
  doneText,
  draftText,
  drillResultText,
  reverseCardText,
} from "../texts";

/** Сколько карточек пользователь ответил в текущей сессии /learn. */
const sessionCounts = new Map<number, number>();

/** Вопрос «работы над ошибками» подмешивается после каждых DRILL_EVERY ответов. */
const DRILL_EVERY = 5;

/** Если подошла очередь и вопрос готов — показывает его вместо карточки. */
async function maybeDrill(ctx: BotContext, deps: Deps, mode: PresentMode): Promise<boolean> {
  ensureDrill(ctx, deps);
  const count = sessionCounts.get(ctx.user.id) ?? 0;
  const state = deps.drills.get(ctx.user.id);
  if (!ctx.user.modeDrill || !state || state.standalone || count === 0 || count % DRILL_EVERY !== 0) return false;
  if (state.lastAtCount === count || state.questions.length === 0) return false;
  state.lastAtCount = count;
  const q = state.questions.shift();
  if (!q) return false;
  await sendDrillQuestion(ctx, state, q, mode);
  return true;
}

const countAnswer = (userId: number) => sessionCounts.set(userId, (sessionCounts.get(userId) ?? 0) + 1);

/** Если карточка дорастает до «вставь по смыслу», заранее готовим предложения в фоне. */
async function prefetchCloze(ctx: BotContext, deps: Deps, cardId: number): Promise<void> {
  if (!ctx.user.modeCloze) return;
  const item = await getDueItemByCard(deps.db, ctx.user.id, cardId);
  if (item && targetStage(item.card) === "cloze") void deps.clozeGen.ensure(item.word);
}

async function showNext(ctx: BotContext, deps: Deps, mode: PresentMode): Promise<void> {
  // Озвучка относилась к прошлой карточке — убираем, чтобы не копилась.
  for (const id of deps.voices.take(ctx.user.id)) await ctx.api.deleteMessage(ctx.chat!.id, id).catch(() => {});
  clearPendingInputs(deps, ctx.user.id);
  if (await maybeDrill(ctx, deps, mode)) return;
  const item = await nextDue(deps.db, ctx.user.id, deps.now());
  let text: string;
  let replyMarkup: InlineKeyboard | undefined;
  if (item) {
    const { card, word } = item;
    const modes = { en_ru: ctx.user.modeEnRu, ru_en: ctx.user.modeRuEn, cloze: ctx.user.modeCloze };
    const target = targetStage(card);
    const sentences = target === "cloze" && modes.cloze ? await listCloze(deps.db, word.id) : [];
    if (target === "cloze" && modes.cloze && sentences.length === 0) void deps.clozeGen.ensure(word);
    const stage = chooseStage(target, modes, sentences.length > 0);
    const sentence = stage === "cloze" ? pickCloze(sentences, card.reps) : undefined;
    if (sentence && ctx.chat) {
      deps.exercises.set(ctx.user.id, { cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, sentence });
      text = clozeText(sentence);
      replyMarkup = clozeKeyboard(card.id, card.reps, word.id);
    } else {
      text = stage === "ru_en" ? reverseCardText(word) : cardText(word);
      replyMarkup = rateKeyboard(card.id, card.reps, card.state === State.New, word.id, stage === "en_ru");
    }
  } else {
    const next = await nextReviewAt(deps.db, ctx.user.id);
    text = doneText(sessionCounts.get(ctx.user.id) ?? 0, next, ctx.user.timezone);
    sessionCounts.delete(ctx.user.id);
  }
  await present(ctx, text, { ...HTML, reply_markup: replyMarkup }, mode);
}

async function startSession(ctx: BotContext, deps: Deps): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return void (await ctx.reply(`Учиться удобнее в личке: https://t.me/${deps.botUsername}`));
  }
  sessionCounts.set(ctx.user.id, 0);
  prefetchDrill(ctx, deps);
  await showNext(ctx, deps, "reply");
}

/** /drill — вопросы по ошибкам подряд, без карточек. */
async function startDrill(ctx: BotContext, deps: Deps): Promise<void> {
  const ready = deps.drills.get(ctx.user.id)?.questions ?? [];
  if (ready.length === 0) await ctx.reply("🧠 Готовлю вопросы по твоим ошибкам, это секунд 15…");
  const questions = ready.length ? ready.splice(0) : await prepareDrill(deps, ctx.user);
  const [first, ...rest] = questions;
  if (!first) {
    return void (await ctx.reply("🧠 Пока не записано ни одной ошибки. Их собирает /check — ответом на сообщение на английском."));
  }
  const state = { questions: rest, standalone: true, lastAtCount: 0 };
  deps.drills.set(ctx.user.id, state);
  await sendDrillQuestion(ctx, state, first, "reply");
}

async function rate(ctx: BotContext, deps: Deps, pending: PendingCloze, answer: "good" | "again"): Promise<boolean> {
  const result = await answerCard(deps.db, {
    userId: ctx.user.id,
    cardId: pending.cardId,
    expectedReps: pending.reps,
    answer,
    now: deps.now(),
  });
  if (result === "stale") {
    await ctx.reply("Уже учтено");
    return false;
  }
  countAnswer(ctx.user.id);
  await prefetchCloze(ctx, deps, pending.cardId);
  return true;
}

/** Ответ на «вставь по смыслу»: точное совпадение — сразу, иначе судит Claude. */
async function checkCloze(ctx: BotContext, deps: Deps, pending: PendingCloze, answer: string): Promise<void> {
  const s = pending.sentence;
  if (isExactAnswer(answer, { answer: s.answer, term: pending.term })) {
    if (!(await rate(ctx, deps, pending, "good"))) return;
    await ctx.reply(clozeCorrectText(s), { ...HTML, reply_markup: audioKeyboard(pending.wordId) });
    return showNext(ctx, deps, "reply");
  }
  await ctx.replyWithChatAction("typing");
  const word = await getWord(deps.db, pending.wordId);
  let judgement: Judgement;
  try {
    judgement = await deps.tutor.judge({
      sentence: s.sentence,
      expected: s.answer,
      term: pending.term,
      translation: word?.translation ?? "",
      answer,
    });
  } catch (err) {
    console.error("Cloze judge failed", err);
    await ctx.reply(`Не получилось проверить 😔 Правильно так:\n\n${clozeFull(s)}\n\nОцени себя сам:`, {
      ...HTML,
      reply_markup: rateKeyboard(pending.cardId, pending.reps, false, pending.wordId, true),
    });
    return;
  }
  if (!(await rate(ctx, deps, pending, judgement.correct ? "good" : "again"))) return;
  await ctx.reply(clozeJudgedText(s, judgement), { ...HTML, reply_markup: audioKeyboard(pending.wordId) });
  await showNext(ctx, deps, "reply");
}

export function registerLearn(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("learn", (ctx) => startSession(ctx, deps));

  bot.command("drill", (ctx) => background(ctx, () => startDrill(ctx, deps)));

  bot.callbackQuery(/^q:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const state = deps.drills.get(ctx.user.id);
    const q = state?.current;
    if (cb?.k !== "drillPick" || !state || !q || cb.qid !== state.currentId) {
      return void (await ctx.answerCallbackQuery({ text: "Этот вопрос уже неактуален" }));
    }
    state.current = undefined;
    state.currentId = undefined;
    void ctx.answerCallbackQuery({ text: cb.index === q.correct ? "✅" : "❌" }).catch(() => {});
    await ctx.editMessageText(drillResultText(q, cb.index), HTML);
    if (!state.standalone) return showNext(ctx, deps, "reply");
    const next = state.questions.shift();
    if (next) return sendDrillQuestion(ctx, state, next, "reply");
    deps.drills.delete(ctx.user.id);
    await ctx.reply("🎉 Готово! Ещё раз — /drill, а слова — /learn.");
  });

  bot.callbackQuery(/^u:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "dunno") return void (await ctx.answerCallbackQuery());
    const item = await getDueItemByCard(deps.db, ctx.user.id, cb.cardId);
    if (!item) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    const pending = deps.exercises.get(ctx.user.id);
    const sentence = pending?.cardId === cb.cardId ? pending.sentence : pickCloze(await listCloze(deps.db, item.word.id), cb.reps);
    const result = await answerCard(deps.db, { userId: ctx.user.id, cardId: cb.cardId, expectedReps: cb.reps, answer: "again", now: deps.now() });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery();
    countAnswer(ctx.user.id);
    await ctx.editMessageText(sentence ? clozeUnknownText(sentence) : draftText(item.word), {
      ...HTML,
      reply_markup: audioKeyboard(item.word.id),
    });
    await showNext(ctx, deps, "reply");
  });

  // Ответ на «вставь по смыслу». Регистрируется раньше общего обработчика текста (иначе ответ стал бы /add).
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const pending = deps.exercises.get(ctx.user.id);
    if (text.startsWith("/") || !pending || pending.chatId !== ctx.chat.id) return next();
    deps.exercises.delete(ctx.user.id);
    background(ctx, () => checkCloze(ctx, deps, pending, text));
  });

  bot.callbackQuery(/^l$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSession(ctx, deps);
  });

  // Кнопка «Показать» осталась только в старых сообщениях — до того, как ответ стал спойлером.
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
    // Не ждём: «часики» снимаются параллельно с обновлением карточки — на одну задержку сети меньше.
    void ctx.answerCallbackQuery().catch(() => {});
    countAnswer(ctx.user.id);
    await prefetchCloze(ctx, deps, cb.cardId);
    await showNext(ctx, deps, "replace");
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
