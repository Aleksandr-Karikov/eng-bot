import { langForms, pickAccent } from "../../lang";
import { startTranslate } from "./translate";
import { dropCard, restoreCard } from "../../services/cards";
import { markTriaged } from "../../services/triage";
import { InlineKeyboard, InputFile, type Bot } from "grammy";
import type { Message } from "grammy/types";
import { State } from "ts-fsrs";
import type { Judgement, LeechHelp } from "../../llm/tutor";
import { listCloze, pickCloze } from "../../services/cloze";
import { gradeDictation, isExactAnswer, pickStage, type Stage } from "../../services/exercises";
import { cardView } from "../../services/card-view";
import { practiceQueue } from "../../services/practice";
import { recordDrillAnswer } from "../../services/mistakes";
import { storedCollocations } from "../../services/collocations";
import { isHard, leechMoment } from "../../services/hard-words";
import { answerCard, getDueItemByCard, markKnown, nextDue, nextReviewAt, undoAnswer } from "../../services/review";
import { getWord, setImageFileId } from "../../services/words";
import type { CardRow, Word } from "../../db/schema";
import { sendWordVoice, wordVoice } from "./audio";
import { allowQuota } from "./quota";
import { addUndoRow, collocationKeyboard, leechKeyboard, mistakesAskKeyboard, restoreCardKeyboard } from "../keyboards";
import { decodeCb, encodeCb, type NextAfter } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { PendingExercise } from "../exercises";
import { clearPendingInputs, endLongModes } from "../pending";
import { activePause, pausesOf } from "../pauses";
import { ensureDrill, prefetchDrill, prepareDrill, present, sendDrillQuestion, type PresentMode } from "./drill";
import {
  addManageButton,
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
  collocationQuizText,
  collocationResultText,
  fillGap,
  leechText,
  LISTEN_TASK_TEXT,
  mistakesAskText,
  sentenceReviewText,
  sentenceTaskText,
  sentenceUnknownText,
  esc,
} from "../texts";

const userModes = (ctx: BotContext) => ({
  en_ru: ctx.user.modeEnRu,
  ru_en: ctx.user.modeRuEn,
  cloze: ctx.user.modeCloze,
  sentence: ctx.user.modeSentence,
  listen: ctx.user.modeListen,
  collocation: ctx.user.modeCollocation,
});

/** Упражнения, которые показывает presentSpecial; если показать не вышло — обычная карточка EN → RU. */
const SPECIAL: Stage[] = ["sentence", "listen", "collocation"];

/**
 * «Своё предложение» и диктант (ждут ответ сообщением), сочетания (ответ кнопкой).
 * false — показать нельзя (не вышла озвучка, нет вопроса), тогда вместо них обычная карточка.
 */
async function presentSpecial(
  ctx: BotContext,
  deps: Deps,
  item: { card: CardRow; word: Word },
  stage: Stage,
  mode: PresentMode,
  practice: boolean,
  undo?: LastAnswer,
): Promise<boolean> {
  const { card, word } = item;
  if (stage === "collocation") {
    const quiz = storedCollocations(word)?.quiz;
    if (!quiz) return false;
    const text = (practice ? PRACTICE_HEADER : "") + collocationQuizText(quiz, word.term);
    await present(ctx, text, { ...HTML, reply_markup: addUndoRow(collocationKeyboard(card.id, card.reps, word.id, quiz.options, practice), undo) }, mode);
    return true;
  }
  if (!ctx.chat || (stage !== "sentence" && stage !== "listen")) return false;
  const accent = pickAccent(deps.random);
  const voice = stage === "listen" ? await wordVoice(deps, word, accent) : undefined;
  if (stage === "listen" && !voice) return false;
  const base = { cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, practice };
  deps.exercises.set(ctx.user.id, stage === "listen" ? { ...base, kind: "listen" } : { ...base, kind: "sentence" });
  const text = (practice ? PRACTICE_HEADER : "") + (stage === "listen" ? LISTEN_TASK_TEXT : sentenceTaskText(word));
  const keyboard = practice ? practiceClozeKeyboard(card.id, word.id) : addUndoRow(clozeKeyboard(card.id, card.reps, word.id), undo);
  rememberTask(deps, ctx.user.id, await present(ctx, text, { ...HTML, reply_markup: keyboard }, mode));
  if (voice) await sendWordVoice(ctx, deps, word, accent, voice);
  return true;
}

/** Сколько карточек пользователь ответил в текущей сессии /learn. */
/** Состояние сессий — своё у каждого экземпляра бота (Deps), а не общее на модуль: иначе оно протекает между ботами в тестах. */
function perBot<T>(): (deps: Deps) => Map<number, T> {
  const maps = new WeakMap<Deps, Map<number, T>>();
  return (deps) => {
    let map = maps.get(deps);
    if (!map) maps.set(deps, (map = new Map()));
    return map;
  };
}
const sessionCountsOf = perBot<number>();
/** Последняя оценка кнопкой — её можно отменить с ближайшей следующей карточки («↩️ Отменить «Забыл»»). */
type LastAnswer = { cardId: number; answer: string; stage?: Stage };
const lastAnswerOf = perBot<LastAnswer>();


/** Лимит подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

/**
 * Итог ответа и что дальше. Верно и пояснять нечего (lead) — короткая строка встаёт шапкой следующего задания,
 * ничего не уезжает наверх. Иначе — разбор отдельным сообщением (или на месте вопроса, edit) с «▶ Дальше»:
 * следующее задание придёт по кнопке, и разбор можно спокойно дочитать.
 */
async function proceed(
  ctx: BotContext,
  deps: Deps,
  then: NextAfter,
  result: { lead?: string; text: string; keyboard?: InlineKeyboard; edit?: boolean },
): Promise<void> {
  if (result.lead !== undefined) {
    // Вопрос (сочетания, работа над ошибками) уходит вместе с итогом в шапку следующего — сам он больше не нужен.
    if (result.edit) await ctx.deleteMessage().catch(() => {});
    ctx.lead = result.lead;
    return goOn(ctx, deps, then);
  }
  const keyboard = (result.keyboard ?? new InlineKeyboard()).row().text("▶ Дальше", encodeCb({ k: "next", then }));
  if (ctx.chat) pausesOf(deps).set(ctx.user.id, { chatId: ctx.chat.id, at: Date.now(), then });
  if (result.edit) await ctx.editMessageText(result.text, { ...HTML, reply_markup: keyboard });
  else await ctx.reply(result.text, { ...HTML, reply_markup: keyboard });
}

async function goOn(ctx: BotContext, deps: Deps, then: NextAfter): Promise<void> {
  pausesOf(deps).delete(ctx.user.id);
  if (then === "practice") return showPractice(ctx, deps, "reply");
  if (then === "learn") return showNext(ctx, deps, "reply");
  const state = deps.drills.get(ctx.user.id);
  const next = state?.questions.shift();
  if (state && next) return sendDrillQuestion(ctx, state, next, "reply");
  deps.drills.delete(ctx.user.id);
  await ctx.reply("🎉 Готово! Ещё раз — /drill, а слова — /learn. Что уже отработано — /mistakes.");
}

const thenOf = (pending: { practice?: boolean }): NextAfter => (pending.practice ? "practice" : "learn");

/** Запомнить сообщение с заданием, которое ждёт ответ текстом, — чтобы потом убрать с него кнопки. */
function rememberTask(deps: Deps, userId: number, sent: Message): void {
  const pending = deps.exercises.get(userId);
  if (pending && pending.messageId === undefined) deps.exercises.set(userId, { ...pending, messageId: sent.message_id });
}

/** Вопрос «работы над ошибками» подмешивается после каждых DRILL_EVERY ответов. */
const DRILL_EVERY = 5;

/** Если подошла очередь и вопрос готов — показывает его вместо карточки. */
async function maybeDrill(ctx: BotContext, deps: Deps, mode: PresentMode): Promise<boolean> {
  ensureDrill(ctx, deps);
  const count = sessionCountsOf(deps).get(ctx.user.id) ?? 0;
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

const countAnswer = (deps: Deps, userId: number) => sessionCountsOf(deps).set(userId, (sessionCountsOf(deps).get(userId) ?? 0) + 1);

/** Разбор трудного слова, который покажем перед следующей карточкой. */
const leechNoticesOf = perBot<{ wordId: number; forgot: number }>();

/**
 * После ответа на карточку: если она дорастает до «вставь по смыслу» — готовим предложения,
 * если слово стало трудным — запоминалку, а на каждом 4-м «Забыл» — разбор слова (его готовим заранее, на 3-м).
 */
async function afterAnswer(ctx: BotContext, deps: Deps, cardId: number): Promise<void> {
  const item = await getDueItemByCard(deps.db, ctx.user.id, cardId);
  if (!item) return;
  // Предложения для «вставь по смыслу» готовим заранее — оно может выпасть на любом следующем показе.
  const optional = item.word.usefulness === 1;
  if (ctx.user.modeCloze && !optional) void deps.clozeGen.ensure(item.word);
  if (ctx.user.modeCollocation && !optional) void deps.collocationGen.ensure(item.word);
  if (!item.word.mnemonic && (await isHard(deps.db, cardId))) void deps.mnemonicGen.ensure(item.word.id);
  const leech = await leechMoment(deps.db, cardId);
  if (leech.prefetch) void deps.mnemonicGen.help(item.word.id);
  if (leech.show) leechNoticesOf(deps).set(ctx.user.id, { wordId: item.word.id, forgot: leech.forgot });
}

/** Показывает отложенный разбор трудного слова. true — сообщение отправлено. */
async function flushLeech(ctx: BotContext, deps: Deps): Promise<boolean> {
  const notice = leechNoticesOf(deps).get(ctx.user.id);
  if (!notice) return false;
  // Только готовый разбор: ждать Claude здесь нельзя — бот обрабатывает апдейты по очереди и встал бы для всех.
  // Не готов — заказываем и покажем перед одной из следующих карточек.
  const word = await getWord(deps.db, notice.wordId);
  if (!word) {
    leechNoticesOf(deps).delete(ctx.user.id);
    return false;
  }
  if (!word.leechHelp) {
    void deps.mnemonicGen.help(notice.wordId);
    return false;
  }
  leechNoticesOf(deps).delete(ctx.user.id);
  const help = JSON.parse(word.leechHelp) as LeechHelp;
  // Разбор длинный — следующая карточка по «▶ Дальше»; итог прошлого ответа — в его начале.
  const lead = ctx.lead;
  ctx.lead = undefined;
  const text = leechText(word, help, notice.forgot);
  await ctx.reply(lead ? `${lead}\n\n${text}` : text, {
    ...HTML,
    reply_markup: leechKeyboard(word.id, Boolean(deps.images)).row().text("▶ Дальше", encodeCb({ k: "next", then: "learn" })),
  });
  return true;
}

/** forced — показать эту карточку (после «↩️ Отменить»), а не очередную; stage — в том же виде, что была. */
async function showNext(ctx: BotContext, deps: Deps, mode: PresentMode, forced?: { item: { card: CardRow; word: Word }; stage?: Stage }): Promise<void> {
  // Озвучка относилась к прошлой карточке — убираем, чтобы не копилась.
  for (const id of deps.voices.take(ctx.user.id)) await ctx.api.deleteMessage(ctx.chat!.id, id).catch(() => {});
  clearPendingInputs(deps, ctx.user.id);
  // Отменить прошлую оценку можно только с ближайшего следующего сообщения.
  const undo = lastAnswerOf(deps).get(ctx.user.id);
  lastAnswerOf(deps).delete(ctx.user.id);
  // Разбор трудного слова встал после прошлой карточки — у неё убираем кнопки, следующая придёт по «▶ Дальше» под разбором.
  if (!forced && (await flushLeech(ctx, deps))) {
    if (mode === "replace") await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }
  if (!forced && (await maybeDrill(ctx, deps, mode))) return;
  const item = forced?.item ?? (await nextDue(deps.db, ctx.user.id, deps.now()));
  let text: string;
  let replyMarkup: InlineKeyboard | undefined;
  let photo: string | InputFile | undefined;
  let photoWordId: number | undefined;
  if (item) {
    const { card, word } = item;
    const modes = userModes(ctx);
    const sentences = modes.cloze ? await listCloze(deps.db, word.id) : [];
    const optional = word.usefulness === 1;
    if (modes.cloze && sentences.length === 0 && card.state !== State.New && !optional) void deps.clozeGen.ensure(word);
    if (modes.collocation && card.state !== State.New && !optional) void deps.collocationGen.ensure(word);
    // Необязательное слово учим только на узнавание: EN → RU, без упражнений на употребление.
    const again = forced?.stage === "en_ru" || forced?.stage === "ru_en" ? forced.stage : forced ? "en_ru" : undefined;
    const picked = again ?? (optional ? "en_ru" : pickStage(card, modes, sentences.length > 0, deps.random, Boolean(storedCollocations(word)?.quiz)));
    if (await presentSpecial(ctx, deps, item, picked, mode, false, undo)) return;
    const stage = SPECIAL.includes(picked) ? "en_ru" : picked;
    const sentence = stage === "cloze" ? pickCloze(sentences, card.reps) : undefined;
    if (sentence && ctx.chat) {
      deps.exercises.set(ctx.user.id, { kind: "cloze", cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, sentence });
      text = clozeText(sentence);
      replyMarkup = addUndoRow(clozeKeyboard(card.id, card.reps, word.id), undo);
    } else {
      const view = cardView(ctx.user);
      text = stage === "ru_en" ? reverseCardText(word, view) : cardText(word, view);
      // Готовая картинка-ассоциация помогает вспомнить — показываем её сразу, текст карточки идёт подписью.
      if (view.picture && text.length <= CAPTION_LIMIT) {
        const painted = word.imageFileId ? undefined : deps.pictures?.find(word);
        photo = word.imageFileId ?? (painted ? new InputFile(painted) : undefined);
        if (painted) photoWordId = word.id;
      }
      replyMarkup = addUndoRow(
        rateKeyboard(card.id, card.reps, card.state === State.New, word.id, (stage === "en_ru" || stage === "ru_en") && view.audio, stage),
        undo,
      );
    }
  } else {
    const next = await nextReviewAt(deps.db, ctx.user.id);
    text = doneText(sessionCountsOf(deps).get(ctx.user.id) ?? 0, next, ctx.user.timezone);
    // Последнюю карточку оценили не той кнопкой — отменить можно и с экрана «Готово».
    replyMarkup = addUndoRow(practiceStartKeyboard(), undo);
    sessionCountsOf(deps).delete(ctx.user.id);
  }
  const sent = await present(ctx, text, { ...HTML, reply_markup: replyMarkup }, mode, photo);
  rememberTask(deps, ctx.user.id, sent);
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
  const optional = word.usefulness === 1;
  if (modes.collocation && !optional) void deps.collocationGen.ensure(word);
  const picked = optional ? "en_ru" : pickStage(card, modes, sentences.length > 0, deps.random, Boolean(storedCollocations(word)?.quiz));
  if (await presentSpecial(ctx, deps, item, picked, mode, true)) return;
  const stage = SPECIAL.includes(picked) ? "en_ru" : picked;
  const sentence = stage === "cloze" ? pickCloze(sentences, Math.floor(deps.random() * sentences.length)) : undefined;
  if (sentence && ctx.chat) {
    deps.exercises.set(ctx.user.id, { kind: "cloze", cardId: card.id, reps: card.reps, wordId: word.id, term: word.term, chatId: ctx.chat.id, sentence, practice: true });
    return rememberTask(deps, ctx.user.id, await present(ctx, PRACTICE_HEADER + clozeText(sentence), { ...HTML, reply_markup: practiceClozeKeyboard(card.id, word.id) }, mode));
  }
  const view = cardView(ctx.user);
  const text = stage === "ru_en" ? reverseCardText(word, view) : cardText(word, view);
  await present(ctx, PRACTICE_HEADER + text, { ...HTML, reply_markup: practiceKeyboard(card.id, word.id, view.audio) }, mode);
}

async function startSession(ctx: BotContext, deps: Deps): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return void (await ctx.reply(`Учиться удобнее в личке: https://t.me/${deps.botUsername}`));
  }
  endLongModes(deps, ctx.user.id);
  pausesOf(deps).delete(ctx.user.id);
  sessionCountsOf(deps).set(ctx.user.id, 0);
  prefetchDrill(ctx, deps);
  await showNext(ctx, deps, "reply");
}

/** /drill — вопросы по ошибкам подряд, без карточек. */
async function startDrill(ctx: BotContext, deps: Deps): Promise<void> {
  const ready = deps.drills.get(ctx.user.id)?.questions ?? [];
  // Лимит — только когда вопросы правда генерируются: готовые лежат в памяти, модель для них не звалась,
  // и брать за них попытку было бы обманом. `/learn` готовит вопросы фоном (`ensureDrill`) и лимит не
  // трогает вовсе — иначе ограничение ударило бы по обычной тренировке, то есть по ядру продукта.
  if (ready.length === 0 && !(await allowQuota(ctx, deps, "drill"))) return;
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
    return void (await ctx.reply(`🧠 Пока не записано ни одной ошибки. Их собирает /check — ответом на сообщение ${langForms().prep}.`));
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
  countAnswer(deps, ctx.user.id);
  await afterAnswer(ctx, deps, pending.cardId);
  return true;
}


/** Диктант: точно или с опечаткой — засчитано, иначе — «забыл». */
async function checkDictation(ctx: BotContext, deps: Deps, pending: PendingExercise, answer: string): Promise<void> {
  const word = await getWord(deps.db, pending.wordId);
  if (!word) return void (await ctx.reply("Это слово уже удалили — /learn, чтобы продолжить"));
  const grade = gradeDictation(answer, word.term);
  if (!pending.practice && !(await rate(ctx, deps, pending, grade === "wrong" ? "again" : "good"))) return;
  await proceed(ctx, deps, thenOf(pending), {
    lead: grade === "exact" ? `✅ Верно: <b>${esc(word.term)}</b> — ${esc(word.translation)}` : undefined,
    text: dictationText(grade, word, answer),
    keyboard: audioKeyboard(word.id),
  });
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
    if (pending.practice) return proceed(ctx, deps, "practice", { text: `Не получилось проверить 😔\n\n${sentenceUnknownText(word)}` });
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
    return proceed(ctx, deps, thenOf(pending), { text: `${text}\n\n${ask}`, keyboard: mistakesAskKeyboard(id) });
  }
  await proceed(ctx, deps, thenOf(pending), { text, keyboard: audioKeyboard(word.id) });
}

async function checkCloze(ctx: BotContext, deps: Deps, pending: PendingExercise & { kind: "cloze" }, answer: string): Promise<void> {
  const s = pending.sentence;
  // Вне зачёта: ответ проверяем, но карточку не оцениваем и продолжаем тренировку.
  const then = thenOf(pending);
  if (isExactAnswer(answer, { answer: s.answer, term: pending.term })) {
    if (!pending.practice && !(await rate(ctx, deps, pending, "good"))) return;
    return proceed(ctx, deps, then, { lead: `✅ Верно: ${clozeFull(s)}`, text: clozeCorrectText(s), keyboard: audioKeyboard(pending.wordId) });
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
    if (pending.practice) return proceed(ctx, deps, then, { text: `Не получилось проверить 😔 Правильно так:\n\n${clozeFull(s)}` });
    await ctx.reply(`Не получилось проверить 😔 Правильно так:\n\n${clozeFull(s)}\n\nОцени себя сам:`, {
      ...HTML,
      reply_markup: rateKeyboard(pending.cardId, pending.reps, false, pending.wordId, true, "cloze"),
    });
    return;
  }
  if (!pending.practice && !(await rate(ctx, deps, pending, judgement.correct ? "good" : "again"))) return;
  // Засчитано без пояснений — как точный ответ; иначе пояснение стоит прочитать.
  const plain = judgement.correct && !judgement.explanation && !judgement.tip;
  await proceed(ctx, deps, then, { lead: plain ? `✅ Засчитано: ${clozeFull(s)}` : undefined, text: clozeJudgedText(s, judgement), keyboard: audioKeyboard(pending.wordId) });
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

  // Кнопки под /mistakes: туда же, что /drill и /translate.
  bot.callbackQuery(/^mg:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "mistakesGo") return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    if (cb.to === "translate") return startTranslate(ctx, deps);
    background(ctx, () => startDrill(ctx, deps));
  });

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
    const right = cb.index === q.correct;
    // Верно и без новостей по теме — коротко в шапку следующего; ошибку и «тема отработана» стоит прочитать.
    const quiet = right && !progress?.resolved;
    const progressLine = progress && quiet ? `\n${drillResultText(q, cb.index, progress).split("\n\n").at(-1)}` : "";
    await proceed(ctx, deps, state.standalone ? "drill" : "learn", {
      lead: quiet ? `✅ Верно: ${fillGap(q.question, q.options[q.correct] ?? "")}${progressLine}` : undefined,
      text: drillResultText(q, cb.index, progress),
      edit: true,
    });
  });

  bot.callbackQuery(/^px$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const queue = await practiceQueue(deps.db, ctx.user.id);
    if (queue.length === 0) return void (await ctx.reply("Пока не на чем тренироваться — сначала поучи новые слова в /learn"));
    endLongModes(deps, ctx.user.id);
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
      if (text) return proceed(ctx, deps, "practice", { text, keyboard: audioKeyboard(pending.wordId), edit: true });
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
    countAnswer(deps, ctx.user.id);
    await afterAnswer(ctx, deps, cb.cardId);
    const revealed = pending ? await unknownText(deps, pending) : sentence ? clozeUnknownText(sentence) : undefined;
    // Правильный ответ — на месте задания; следующее — по «▶ Дальше», когда прочитал.
    await proceed(ctx, deps, "learn", { text: revealed ?? draftText(item.word), keyboard: audioKeyboard(item.word.id), edit: true });
  });

  // Ответ на «вставь по смыслу». Регистрируется раньше общего обработчика текста (иначе ответ стал бы /add).
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const pending = deps.exercises.get(ctx.user.id);
    const pause = !text.startsWith("/") && !pending ? activePause(deps, ctx.user.id, ctx.chat.id) : undefined;
    if (pause) {
      // Кнопка — прямо здесь: вдруг под разбором её уже нет или до него далеко листать.
      return void (await ctx.reply("Разбор ждёт: следующее задание — по кнопке. Добавить слово — /add", {
        reply_markup: new InlineKeyboard().text("▶ Дальше", encodeCb({ k: "next", then: pause.then })),
      }));
    }
    if (text.startsWith("/") || !pending || pending.chatId !== ctx.chat.id) return next();
    deps.exercises.delete(ctx.user.id);
    // Ответили — «🤷 Не знаю» у задания больше не нужна; «⚙️ Управление словом» оставляем.
    if (pending.messageId !== undefined) {
      void ctx.api
        .editMessageReplyMarkup(pending.chatId, pending.messageId, { reply_markup: pending.practice ? undefined : addManageButton(new InlineKeyboard(), pending.wordId) })
        .catch(() => {});
    }
    if (pending.kind === "cloze") background(ctx, () => checkCloze(ctx, deps, pending, text));
    else if (pending.kind === "sentence") background(ctx, () => checkSentence(ctx, deps, pending, text));
    else await checkDictation(ctx, deps, pending, text);
  });

  // Ответ на «сочетания»: в зачёт — оценка карточки, вне зачёта — только разбор.
  bot.callbackQuery(/^co:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "collocationPick") return void (await ctx.answerCallbackQuery());
    const item = await getDueItemByCard(deps.db, ctx.user.id, cb.cardId);
    const collocations = item ? storedCollocations(item.word) : undefined;
    if (!item || !collocations?.quiz) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили или изменили" }));
    const correct = cb.index === collocations.quiz.correct;
    if (!cb.practice) {
      const result = await answerCard(deps.db, {
        userId: ctx.user.id,
        cardId: cb.cardId,
        expectedReps: cb.reps,
        answer: correct ? "good" : "again",
        now: deps.now(),
        stage: "collocation",
      });
      if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
      countAnswer(deps, ctx.user.id);
      await afterAnswer(ctx, deps, cb.cardId);
    }
    void ctx.answerCallbackQuery({ text: correct ? "✅" : "❌" }).catch(() => {});
    const quiz = collocations.quiz;
    await proceed(ctx, deps, cb.practice ? "practice" : "learn", {
      lead: correct ? `✅ Верно: ${fillGap(quiz.question, quiz.options[quiz.correct] ?? "")}` : undefined,
      text: collocationResultText(collocations, cb.index),
      keyboard: audioKeyboard(item.word.id),
      edit: true,
    });
  });

  // «▶ Дальше» под разбором: кнопку убираем (разбор остаётся), дальше — следующее задание.
  bot.callbackQuery(/^nx:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "next") return void (await ctx.answerCallbackQuery());
    void ctx.answerCallbackQuery().catch(() => {});
    const rows = (ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [])
      .map((row) => row.filter((b) => !("callback_data" in b && b.callback_data.startsWith("nx:"))))
      .filter((row) => row.length > 0);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard(rows) }).catch(() => {});
    // Вторая «Дальше» (под разбором и под подсказкой): следующее задание уже ждёт ответа — второе не присылаем.
    if (!pausesOf(deps).has(ctx.user.id) && deps.exercises.get(ctx.user.id)) return;
    if (cb.then === "drill" && !deps.drills.get(ctx.user.id)) return void (await ctx.reply("Вопросы закончились — /drill, чтобы начать заново"));
    await goOn(ctx, deps, cb.then);
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
    countAnswer(deps, ctx.user.id);
    await afterAnswer(ctx, deps, cb.cardId);
    lastAnswerOf(deps).set(ctx.user.id, { cardId: cb.cardId, answer: cb.answer, stage });
    await showNext(ctx, deps, "replace");
  });

  // «↩️ Отменить «Забыл»»: прошлая оценка отменяется, та карточка возвращается — оценить заново.
  bot.callbackQuery(/^ud:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "undo") return void (await ctx.answerCallbackQuery());
    const undone = await undoAnswer(deps.db, { userId: ctx.user.id, cardId: cb.cardId });
    const item = undone ? await getDueItemByCard(deps.db, ctx.user.id, cb.cardId) : undefined;
    if (!undone || !item) return void (await ctx.answerCallbackQuery({ text: "Этот ответ уже не отменить" }));
    void ctx.answerCallbackQuery({ text: "↩️ Отменено — оцени заново" }).catch(() => {});
    const count = sessionCountsOf(deps).get(ctx.user.id);
    if (count) sessionCountsOf(deps).set(ctx.user.id, count - 1);
    // Разбор «трудного слова», заказанный этим ответом, больше не к месту.
    if (leechNoticesOf(deps).get(ctx.user.id)?.wordId === item.word.id) leechNoticesOf(deps).delete(ctx.user.id);
    await showNext(ctx, deps, "replace", { item, stage: cb.stage });
  });

  // «🙈 Не для меня»: слово уходит только из моих карточек. Из /learn — сразу следующая карточка.
  bot.callbackQuery(/^nf:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "notForMe" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "notForMe" || !word) return void (await ctx.answerCallbackQuery({ text: "Этого слова уже нет" }));
    await dropCard(deps.db, ctx.user.id, word.id);
    await ctx.answerCallbackQuery({ text: "🙈 Убрал у тебя" });
    const text = `🙈 <b>${esc(word.term)}</b> убрано из твоих слов — у остальных осталось.`;
    if (cb.from === "know") return void (await ctx.editMessageText(text, { ...HTML, reply_markup: restoreCardKeyboard(word.id) }));
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(text, { ...HTML, reply_markup: restoreCardKeyboard(word.id) });
    if (ctx.chat?.type === "private") await showNext(ctx, deps, "reply");
  });

  bot.callbackQuery(/^nr:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "restoreCard" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "restoreCard" || !word) return void (await ctx.answerCallbackQuery({ text: "Этого слова уже нет" }));
    await restoreCard(deps.db, ctx.user.id, word.id, deps.now());
    await ctx.answerCallbackQuery({ text: "↩️ Вернул" });
    await ctx.editMessageText(`↩️ <b>${esc(word.term)}</b> снова в твоих словах — встретится в /learn`, HTML);
  });

  bot.callbackQuery(/^k:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "know" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "know") return void (await ctx.answerCallbackQuery());
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (!cb.knows) {
      // Решено — в колоде «новые от друзей» в приложении это слово уже не покажем.
      await markTriaged(deps.db, ctx.user.id, word.id, deps.now());
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`${draftText(word)}\n\n📚 Добавлено в изучение — встретится в /learn`, HTML));
    }
    const result = await markKnown(deps.db, { userId: ctx.user.id, wordId: word.id, now: deps.now() });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await markTriaged(deps.db, ctx.user.id, word.id, deps.now());
    await ctx.answerCallbackQuery({ text: "👍" });
    await ctx.editMessageText(`${draftText(word)}\n\n✅ Отмечено как известное — проверю через пару недель`, HTML);
  });
}
