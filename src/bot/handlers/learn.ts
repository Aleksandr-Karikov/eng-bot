import { InputFile, type Bot, type InlineKeyboard } from "grammy";
import { State } from "ts-fsrs";
import type { Judgement } from "../../llm/tutor";
import { listCloze, pickCloze } from "../../services/cloze";
import { gradeDictation, isExactAnswer, pickStage, type Stage } from "../../services/exercises";
import { cardView } from "../../services/card-view";
import { practiceQueue } from "../../services/practice";
import { recordDrillAnswer } from "../../services/mistakes";
import { isHard, leechMoment } from "../../services/hard-words";
import { answerCard, getDueItemByCard, markKnown, nextDue, nextReviewAt } from "../../services/review";
import { getWord, setImageFileId } from "../../services/words";
import type { CardRow, Word } from "../../db/schema";
import { sendWordVoice, wordVoice } from "./audio";
import { leechKeyboard, mistakesAskKeyboard } from "../keyboards";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { PendingExercise } from "../exercises";
import { clearPendingInputs } from "../pending";
import { ensureDrill, prefetchDrill, prepareDrill, present, sendDrillQuestion, type PresentMode } from "./drill";
import {
  audioKeyboard,
  clozeKeyboard,
  practiceClozeKeyboard,
  practiceKeyboard,
  practiceStartKeyboard,
  rateKeyboard,
} from "../keyboards";
import {
  cardText,
  clozeCorrectText,
  clozeFull,
  clozeJudgedText,
  clozeText,
  clozeUnknownText,
  doneText,
  draftText,
  PRACTICE_HEADER,
  practiceDoneText,
  drillResultText,
  reverseCardText,
  dictationText,
  leechText,
  LISTEN_TASK_TEXT,
  mistakesAskText,
  sentenceReviewText,
  sentenceTaskText,
  sentenceUnknownText,
} from "../texts";

const userModes = (ctx: BotContext) => ({
  en_ru: ctx.user.modeEnRu,
  ru_en: ctx.user.modeRuEn,
  cloze: ctx.user.modeCloze,
  sentence: ctx.user.modeSentence,
  listen: ctx.user.modeListen,
});

/**
 * «Своё предложение» и диктант: показывает задание и ждёт ответ сообщением.
 * false — показать нельзя (не вышла озвучка), тогда вместо них обычная карточка.
 */
async function presentWritten(
  ctx: BotContext,
  deps: Deps,
  item: { card: CardRow; word: Word },
  stage: Stage,
  mode: PresentMode,
  practice: boolean,
): Promise<boolean> {
  const { card, word } = item;
  if (!ctx.chat || (stage !== "sentence" && stage !== "listen")) return false;
  const accent = deps.random() < 0.5 ? "uk" : "us";
  const voice = stage === "listen" ? await wordVoice(deps, word, accent) : undefined;
  if (stage === "listen" && !voice) return false;
  const base = { cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, practice };
  deps.exercises.set(ctx.user.id, stage === "listen" ? { ...base, kind: "listen" } : { ...base, kind: "sentence" });
  const text = (practice ? PRACTICE_HEADER : "") + (stage === "listen" ? LISTEN_TASK_TEXT : sentenceTaskText(word));
  const keyboard = practice ? practiceClozeKeyboard(card.id, word.id) : clozeKeyboard(card.id, card.reps, word.id);
  await present(ctx, text, { ...HTML, reply_markup: keyboard }, mode);
  if (voice) await sendWordVoice(ctx, deps, word, accent, voice);
  return true;
}

/** Сколько карточек пользователь ответил в текущей сессии /learn. */
const sessionCounts = new Map<number, number>();

/** Лимит подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

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

const sameTopic = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const countAnswer = (userId: number) => sessionCounts.set(userId, (sessionCounts.get(userId) ?? 0) + 1);

/** Разбор трудного слова, который покажем перед следующей карточкой. */
const leechNotices = new Map<number, { wordId: number; forgot: number }>();

/**
 * После ответа на карточку: если она дорастает до «вставь по смыслу» — готовим предложения,
 * если слово стало трудным — запоминалку, а на каждом 4-м «Забыл» — разбор слова (его готовим заранее, на 3-м).
 */
async function afterAnswer(ctx: BotContext, deps: Deps, cardId: number): Promise<void> {
  const item = await getDueItemByCard(deps.db, ctx.user.id, cardId);
  if (!item) return;
  // Предложения для «вставь по смыслу» готовим заранее — оно может выпасть на любом следующем показе.
  if (ctx.user.modeCloze) void deps.clozeGen.ensure(item.word);
  if (!item.word.mnemonic && (await isHard(deps.db, cardId))) void deps.mnemonicGen.ensure(item.word.id);
  const leech = await leechMoment(deps.db, cardId);
  if (leech.prefetch) void deps.mnemonicGen.help(item.word.id);
  if (leech.show) leechNotices.set(ctx.user.id, { wordId: item.word.id, forgot: leech.forgot });
}

/** Показывает отложенный разбор трудного слова. true — сообщение отправлено. */
async function flushLeech(ctx: BotContext, deps: Deps): Promise<boolean> {
  const notice = leechNotices.get(ctx.user.id);
  if (!notice) return false;
  leechNotices.delete(ctx.user.id);
  await ctx.replyWithChatAction("typing").catch(() => {});
  const help = await deps.mnemonicGen.help(notice.wordId);
  const word = help ? await getWord(deps.db, notice.wordId) : undefined;
  if (!help || !word) return false;
  await ctx.reply(leechText(word, help, notice.forgot), { ...HTML, reply_markup: leechKeyboard(word.id, Boolean(deps.images)) });
  return true;
}

async function showNext(ctx: BotContext, deps: Deps, mode: PresentMode): Promise<void> {
  // Озвучка относилась к прошлой карточке — убираем, чтобы не копилась.
  for (const id of deps.voices.take(ctx.user.id)) await ctx.api.deleteMessage(ctx.chat!.id, id).catch(() => {});
  clearPendingInputs(deps, ctx.user.id);
  // Разбор встал после прошлой карточки — следующую присылаем новым сообщением под ним, а у прошлой убираем кнопки.
  if ((await flushLeech(ctx, deps)) && mode === "replace") {
    await ctx.editMessageReplyMarkup().catch(() => {});
    mode = "reply";
  }
  if (await maybeDrill(ctx, deps, mode)) return;
  const item = await nextDue(deps.db, ctx.user.id, deps.now());
  let text: string;
  let replyMarkup: InlineKeyboard | undefined;
  let photo: string | InputFile | undefined;
  let photoWordId: number | undefined;
  if (item) {
    const { card, word } = item;
    const modes = userModes(ctx);
    const sentences = modes.cloze ? await listCloze(deps.db, word.id) : [];
    if (modes.cloze && sentences.length === 0 && card.state !== State.New) void deps.clozeGen.ensure(word);
    const picked = pickStage(card, modes, sentences.length > 0, deps.random);
    if (await presentWritten(ctx, deps, item, picked, mode, false)) return;
    const stage = picked === "sentence" || picked === "listen" ? "en_ru" : picked;
    const sentence = stage === "cloze" ? pickCloze(sentences, card.reps) : undefined;
    if (sentence && ctx.chat) {
      deps.exercises.set(ctx.user.id, { kind: "cloze", cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, sentence });
      text = clozeText(sentence);
      replyMarkup = clozeKeyboard(card.id, card.reps, word.id);
    } else {
      const view = cardView(ctx.user);
      text = stage === "ru_en" ? reverseCardText(word, view) : cardText(word, view);
      // Готовая картинка-ассоциация помогает вспомнить — показываем её сразу, текст карточки идёт подписью.
      if (view.picture && text.length <= CAPTION_LIMIT) {
        const painted = word.imageFileId ? undefined : deps.pictures?.find(word);
        photo = word.imageFileId ?? (painted ? new InputFile(painted) : undefined);
        if (painted) photoWordId = word.id;
      }
      replyMarkup = rateKeyboard(
        card.id,
        card.reps,
        card.state === State.New,
        word.id,
        stage === "en_ru" && view.audio,
        stage,
      );
    }
  } else {
    const next = await nextReviewAt(deps.db, ctx.user.id);
    text = doneText(sessionCounts.get(ctx.user.id) ?? 0, next, ctx.user.timezone);
    replyMarkup = practiceStartKeyboard();
    sessionCounts.delete(ctx.user.id);
  }
  const sent = await present(ctx, text, { ...HTML, reply_markup: replyMarkup }, mode, photo);
  // Картинка, нарисованная в фоне, ушла в Telegram впервые — дальше отправляем по file_id.
  const best = "photo" in sent ? sent.photo?.at(-1) : undefined;
  if (photoWordId !== undefined && best) await setImageFileId(deps.db, photoWordId, best.file_id);
}

/** Следующая карточка тренировки вне зачёта (ответы не оцениваются) или её итог. */
async function showPractice(ctx: BotContext, deps: Deps, mode: PresentMode): Promise<void> {
  clearPendingInputs(deps, ctx.user.id);
  for (const id of deps.voices.take(ctx.user.id)) await ctx.api.deleteMessage(ctx.chat!.id, id).catch(() => {});
  const cardId = deps.practice.next(ctx.user.id);
  const item = cardId !== undefined ? await getDueItemByCard(deps.db, ctx.user.id, cardId) : undefined;
  if (!item) {
    deps.practice.stop(ctx.user.id);
    return void (await present(ctx, practiceDoneText(), HTML, mode));
  }
  const { card, word } = item;
  const modes = userModes(ctx);
  const sentences = modes.cloze ? await listCloze(deps.db, word.id) : [];
  const picked = pickStage(card, modes, sentences.length > 0, deps.random);
  if (await presentWritten(ctx, deps, item, picked, mode, true)) return;
  const stage = picked === "sentence" || picked === "listen" ? "en_ru" : picked;
  const sentence = stage === "cloze" ? pickCloze(sentences, Math.floor(deps.random() * sentences.length)) : undefined;
  if (sentence && ctx.chat) {
    deps.exercises.set(ctx.user.id, { kind: "cloze", cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, sentence, practice: true });
    return void (await present(ctx, PRACTICE_HEADER + clozeText(sentence), { ...HTML, reply_markup: practiceClozeKeyboard(card.id, word.id) }, mode));
  }
  const view = cardView(ctx.user);
  const text = stage === "ru_en" ? reverseCardText(word, view) : cardText(word, view);
  await present(ctx, PRACTICE_HEADER + text, { ...HTML, reply_markup: practiceKeyboard(card.id, word.id, stage !== "ru_en" && view.audio) }, mode);
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
  let questions;
  try {
    questions = ready.length ? ready.splice(0) : await prepareDrill(deps, ctx.user);
  } catch (err) {
    console.error("Drill generation failed", err);
    return void (await ctx.reply("Не получилось подготовить вопросы 😔 Попробуй чуть позже — /drill"));
  }
  const [first, ...rest] = questions;
  if (!first) {
    return void (await ctx.reply("🧠 Пока не записано ни одной ошибки. Их собирает /check — ответом на сообщение на английском."));
  }
  const state = { questions: rest, standalone: true, lastAtCount: 0 };
  deps.drills.set(ctx.user.id, state);
  await sendDrillQuestion(ctx, state, first, "reply");
}

async function rate(ctx: BotContext, deps: Deps, pending: PendingExercise, answer: "good" | "again"): Promise<boolean> {
  const result = await answerCard(deps.db, {
    userId: ctx.user.id,
    cardId: pending.cardId,
    expectedReps: pending.reps,
    answer,
    now: deps.now(),
    stage: pending.kind,
  });
  if (result === "stale") {
    await ctx.reply("Уже учтено");
    return false;
  }
  countAnswer(ctx.user.id);
  await afterAnswer(ctx, deps, pending.cardId);
  return true;
}

/** Ответ на «вставь по смыслу»: точное совпадение — сразу, иначе судит Claude. */
const continueAfter = (ctx: BotContext, deps: Deps, pending: PendingExercise) =>
  pending.practice ? showPractice(ctx, deps, "reply") : showNext(ctx, deps, "reply");

/** Диктант: точно или с опечаткой — засчитано, иначе — «забыл». */
async function checkDictation(ctx: BotContext, deps: Deps, pending: PendingExercise, answer: string): Promise<void> {
  const word = await getWord(deps.db, pending.wordId);
  if (!word) return void (await ctx.reply("Это слово уже удалили — /learn, чтобы продолжить"));
  const grade = gradeDictation(answer, word.term);
  if (!pending.practice && !(await rate(ctx, deps, pending, grade === "wrong" ? "again" : "good"))) return;
  await ctx.reply(dictationText(grade, word, answer), { ...HTML, reply_markup: audioKeyboard(word.id) });
  await continueAfter(ctx, deps, pending);
}

/** Своё предложение: Claude смотрит, верно ли употреблено слово (это и оценка), и правит остальные ошибки. */
async function checkSentence(ctx: BotContext, deps: Deps, pending: PendingExercise, answer: string): Promise<void> {
  const word = await getWord(deps.db, pending.wordId);
  if (!word) return void (await ctx.reply("Это слово уже удалили — /learn, чтобы продолжить"));
  await ctx.replyWithChatAction("typing");
  let review;
  try {
    review = await deps.tutor.reviewSentence({ term: word.term, translation: word.translation, explanation: word.explanation, answer });
  } catch (err) {
    console.error("Sentence review failed", err);
    if (pending.practice) {
      await ctx.reply(`Не получилось проверить 😔\n\n${sentenceUnknownText(word)}`, HTML);
      return continueAfter(ctx, deps, pending);
    }
    await ctx.reply(`Не получилось проверить 😔\n\n${sentenceUnknownText(word)}\n\nОцени себя сам:`, {
      ...HTML,
      reply_markup: rateKeyboard(pending.cardId, pending.reps, false, word.id, false, "sentence"),
    });
    return;
  }
  if (!pending.practice && !(await rate(ctx, deps, pending, review.usesWord ? "good" : "again"))) return;
  const text = sentenceReviewText(review, word);
  const real = review.fixes.filter((f) => !f.slip);
  if (real.length) {
    // Как в /check: в работу над ошибками — только после «✅ Сохранить».
    const id = deps.pendingMistakes.create({ authorUserId: ctx.user.id, callerUserId: ctx.user.id, fixes: real, baseText: text });
    const ask = mistakesAskText(undefined, real.map((f) => f.category ?? ""));
    await ctx.reply(`${text}\n\n${ask}`, { ...HTML, reply_markup: mistakesAskKeyboard(id) });
  } else {
    await ctx.reply(text, { ...HTML, reply_markup: audioKeyboard(word.id) });
  }
  await continueAfter(ctx, deps, pending);
}

async function checkCloze(ctx: BotContext, deps: Deps, pending: PendingExercise & { kind: "cloze" }, answer: string): Promise<void> {
  const s = pending.sentence;
  // Вне зачёта: ответ проверяем, но карточку не оцениваем и продолжаем тренировку.
  const continueAfter = () => (pending.practice ? showPractice(ctx, deps, "reply") : showNext(ctx, deps, "reply"));
  if (isExactAnswer(answer, { answer: s.answer, term: pending.term })) {
    if (!pending.practice && !(await rate(ctx, deps, pending, "good"))) return;
    await ctx.reply(clozeCorrectText(s), { ...HTML, reply_markup: audioKeyboard(pending.wordId) });
    return continueAfter();
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
    if (pending.practice) {
      await ctx.reply(`Не получилось проверить 😔 Правильно так:\n\n${clozeFull(s)}`, HTML);
      return continueAfter();
    }
    await ctx.reply(`Не получилось проверить 😔 Правильно так:\n\n${clozeFull(s)}\n\nОцени себя сам:`, {
      ...HTML,
      reply_markup: rateKeyboard(pending.cardId, pending.reps, false, pending.wordId, true, "cloze"),
    });
    return;
  }
  if (!pending.practice && !(await rate(ctx, deps, pending, judgement.correct ? "good" : "again"))) return;
  await ctx.reply(clozeJudgedText(s, judgement), { ...HTML, reply_markup: audioKeyboard(pending.wordId) });
  await continueAfter();
}

/** «🤷 Не знаю»: правильный ответ для показанного упражнения. */
async function unknownText(deps: Deps, pending: PendingExercise): Promise<string | undefined> {
  if (pending.kind === "cloze") return clozeUnknownText(pending.sentence);
  const word = await getWord(deps.db, pending.wordId);
  if (!word) return undefined;
  return pending.kind === "listen" ? dictationText("unknown", word) : sentenceUnknownText(word);
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
    const progress = await recordDrillAnswer(deps.db, ctx.user.id, q.category, cb.index === q.correct, deps.now());
    // Отработанная тема: уже готовые вопросы по ней больше не показываем.
    if (progress?.resolved) state.questions = state.questions.filter((other) => !sameTopic(other.category, progress.category));
    await ctx.editMessageText(drillResultText(q, cb.index, progress), HTML);
    if (!state.standalone) return showNext(ctx, deps, "reply");
    const next = state.questions.shift();
    if (next) return sendDrillQuestion(ctx, state, next, "reply");
    deps.drills.delete(ctx.user.id);
    await ctx.reply("🎉 Готово! Ещё раз — /drill, а слова — /learn. Что уже отработано — /mistakes.");
  });

  bot.callbackQuery(/^px$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const queue = await practiceQueue(deps.db, ctx.user.id);
    if (queue.length === 0) return void (await ctx.reply("Пока не на чем тренироваться — сначала поучи новые слова в /learn"));
    deps.practice.start(ctx.user.id, queue);
    await showPractice(ctx, deps, "reply");
  });

  bot.callbackQuery(/^pr:/, async (ctx) => {
    void ctx.answerCallbackQuery().catch(() => {});
    await showPractice(ctx, deps, "replace");
  });

  bot.callbackQuery(/^pu:/, async (ctx) => {
    const pending = deps.exercises.get(ctx.user.id);
    await ctx.answerCallbackQuery();
    if (pending?.practice) {
      deps.exercises.delete(ctx.user.id);
      const text = await unknownText(deps, pending);
      if (text) await ctx.editMessageText(text, { ...HTML, reply_markup: audioKeyboard(pending.wordId) });
    }
    await showPractice(ctx, deps, "reply");
  });

  bot.callbackQuery(/^pz$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    deps.practice.stop(ctx.user.id);
    clearPendingInputs(deps, ctx.user.id);
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(practiceDoneText());
  });

  bot.callbackQuery(/^u:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "dunno") return void (await ctx.answerCallbackQuery());
    const item = await getDueItemByCard(deps.db, ctx.user.id, cb.cardId);
    if (!item) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    const current = deps.exercises.get(ctx.user.id);
    const pending = current?.cardId === cb.cardId ? current : undefined;
    const sentence = pending ? undefined : pickCloze(await listCloze(deps.db, item.word.id), cb.reps);
    const result = await answerCard(deps.db, {
      userId: ctx.user.id,
      cardId: cb.cardId,
      expectedReps: cb.reps,
      answer: "again",
      now: deps.now(),
      stage: pending?.kind ?? "cloze",
    });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery();
    countAnswer(ctx.user.id);
    await afterAnswer(ctx, deps, cb.cardId);
    const revealed = pending ? await unknownText(deps, pending) : sentence ? clozeUnknownText(sentence) : undefined;
    await ctx.editMessageText(revealed ?? draftText(item.word), {
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
    if (pending.kind === "cloze") background(ctx, () => checkCloze(ctx, deps, pending, text));
    else if (pending.kind === "sentence") background(ctx, () => checkSentence(ctx, deps, pending, text));
    else await checkDictation(ctx, deps, pending, text);
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
    const stage = cb.stage;
    const result = await answerCard(deps.db, {
      userId: ctx.user.id,
      cardId: cb.cardId,
      expectedReps: cb.reps,
      answer: cb.answer,
      now: deps.now(),
      stage,
    });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    // Не ждём: «часики» снимаются параллельно с обновлением карточки — на одну задержку сети меньше.
    void ctx.answerCallbackQuery().catch(() => {});
    countAnswer(ctx.user.id);
    await afterAnswer(ctx, deps, cb.cardId);
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
