import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Api } from "grammy";
import { compressPicture } from "../images/compress";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import type { User, Word } from "../db/schema";
import { dropNewCard } from "../services/cards";
import { cardView } from "../services/card-view";
import { autoVoice } from "../services/voice";
import { decide, listSets, nextSetItems, setSetTarget, setTarget, setTargetChoices, starterSet, undoDecision, type SetDecision } from "../services/word-sets";
import { cards as cardsTable, roomMembers, setItems, wordSets } from "../db/schema";
import { count, eq } from "drizzle-orm";
import { progressReport } from "../services/progress";
import { bossEnabled, bossFeed, bossOf, buyPiercingRune, buyUpgrade, coinState, personalDamage, settledBank, UPGRADES } from "../services/boss";
import { answerExercise, explanationPrompt, grammarExerciseWithTopic, listTopics, topicView } from "../services/grammar-topics";
import { checkAndCount } from "../services/limits";
import { attackWithReserve, combatState, isMobTarget } from "../services/combat";
import { TROPHIES, userTrophies } from "../services/trophies";
import { ensureDrillFor, rememberAsked } from "../bot/handlers/drill";
import { extraBatchLabel, formatDateTime, gapParts, learningLimitNotice, reverseHint } from "../bot/texts";
import { storedCollocations } from "../services/collocations";
import { pickStage, reviewStages } from "../services/exercises";
import { listCloze, pickCloze } from "../services/cloze";
import { recordDrillAnswer } from "../services/mistakes";
import { KNOW_STAGE } from "../services/goals";
import { recordAnswer, countDueSplit, dueQueue, extraQueue, getDueItemByCard, nextReviewAt, type StudyScope } from "../services/review";
import { practiceQueue } from "../services/practice";
import { weakDirections } from "../services/weak-direction";
import { ensurePersonalRoom, getRoom } from "../services/rooms";
import { getUserByTelegramId } from "../services/users";
import { EN, langForms } from "../lang";
import type { Answer } from "../srs/srs";
import { localParts } from "../time";
import { CHOICE_INDEX, scheduleExercises } from "./exercise-mix";

/** Сколько карточек отдавать за раз: приложение показывает их без ожидания, ответы шлёт в фоне. */
const QUEUE_SIZE = 20;
const AUDIO_DIR = resolve("data/audio");

/** Вопрос с вариантами и разбор: пропуск в предложении, верный ответ уже подставлен (filled) — без повтора на стыке. */
export interface AppQuiz {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  filled: { before: string; answer: string; after: string };
}

export interface AppCard {
  kind: "card";
  /** Тренировка вне зачёта: ответ проверяется, но карточка не оценивается. */
  practice?: boolean;
  extra?: true;
  cardId: number;
  reps: number;
  isNew: boolean;
  needsDecision?: true;
  /** EN → RU, RU → EN, сочетания, пропуск по смыслу, диктант или реплика в диалоге. */
  stage: "en_ru" | "ru_en" | "collocation" | "cloze" | "listen" | "sentence";
  /** Для «вставь по смыслу»: предложение с пропуском и перевод (ответ — только после проверки). */
  cloze?: { id: number; sentence: string; translation: string };
  /** Для сочетаний: вопрос и все частые сочетания слова для разбора. */
  quiz?: AppQuiz & { items: Array<{ phrase: string; translation: string }> };
  word: {
    id: number;
    term: string;
    translation: string;
    explanation: string;
    /** Для RU → EN: смысл под переводом (объяснение, если не выдаёт слово), иначе пусто. */
    meaningHint: string;
    example: string;
    /** Перевод примера, если его уже спрашивали тапом; "" — ещё нет. */
    exampleTranslation: string;
    context: string;
    mnemonic: string;
    transcriptionUk: string;
    transcriptionUs: string;
    usefulness: number | null;
    hasPicture: boolean;
    /** Часть речи и уровень: «существительное · B1»; пусто — ещё не готово. */
    partOfSpeech: string;
    cefr: string;
    forms: Array<{ form: string; label: string }>;
    synonyms: Array<{ term: string; translation: string }>;
    antonyms: Array<{ term: string; translation: string }>;
  };
}

export async function appUser(deps: Pick<Deps, "db" | "now">, telegramId: number): Promise<User | undefined> {
  const user = await getUserByTelegramId(deps.db, telegramId);
  if (!user) return user;
  // Как в боте: личный словарь есть у каждого; без комнаты он и становится текущим.
  await ensurePersonalRoom(deps.db, user.id, deps.now());
  return user.currentRoomId != null ? user : getUserByTelegramId(deps.db, telegramId);
}

export async function appMe(deps: Deps, user: User) {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  const now = deps.now();
  const due = await countDueSplit(deps.db, user.id, now);
  const next = due.review === 0 ? await nextReviewAt(deps.db, user.id) : undefined;
  let nextReview: string | undefined;
  if (next && next > now) {
    const local = localParts(user.timezone, next);
    nextReview = local.date === localParts(user.timezone, now).date ? `сегодня в ${local.time}` : formatDateTime(next, user.timezone);
  }
  // Сколько слов у человека вообще. Без этого `due: 0/0` не отличить «всё повторил» от «нечего учить»,
  // а экран пустой очереди показывает новичку совсем другое предложение, чем прилежному ученику.
  const [cards] = await deps.db.select({ n: count() }).from(cardsTable).where(eq(cardsTable.userId, user.id));
  const total = cards?.n ?? 0;
  // Плоско и коротко, как `appSets`: приложению тут нужны только id, название и размер.
  const starter = total === 0 ? await starterSet(deps.db) : undefined;
  const boss = bossEnabled(user, deps.bossEnabled);
  return {
    name: user.firstName,
    room: room?.name ?? null,
    due,
    nextReview,
    limitNotices: {
      all: learningLimitNotice(due, user),
      fresh: learningLimitNotice(due, user, "fresh"),
      reviews: learningLimitNotice(due, user, "reviews"),
    },
    extraLabels: { all: extraBatchLabel(due), fresh: extraBatchLabel(due, "fresh"), reviews: extraBatchLabel(due, "reviews") },
    total,
    // Чем занять новичка: пустой `/learn` предлагает именно этот набор (см. `starterSet`).
    ...(starter ? { starterSet: { id: starter.set.id, title: starter.set.title, total: starter.total } } : {}),
    view: cardView(user),
    // 🗣 Каким произношением озвучивать карточку самим: null — озвучка выключена (как было всегда).
    voice: autoVoice(user) ?? null,
    // 🐉 Вкладка босса: личный режим И общий рубильник. Выключено — приложение не рисует кнопку вовсе.
    boss,
    bankDamage: boss, // Для уже открытого Mini App: знак ⚡ у полученной награды.
    // Изучаемый язык: какие кнопки озвучки и подписи транскрипции показывать.
    language: {
      code: EN.code,
      flag: EN.flag,
      accents: EN.accents.map((a) => ({ key: a, label: EN.accentLabel[a] })),
      adv: langForms().adv,
      neut: langForms().neut,
    },
  };
}

function hasPicture(deps: Deps, word: Word): boolean {
  return Boolean(word.imageFileId || deps.pictures?.find(word));
}

/** 🧠 Вопрос по ошибкам, который занимает место вопроса с вариантами в очереди. */
export interface AppDrill extends AppQuiz {
  kind: "drill";
  id: string;
  category: string;
}

export type AppItem = AppCard | AppDrill;

/**
 * Сколько карточек за один запрос очереди готовить в фоне. Остальные подготовятся, когда до них дойдёт
 * дело: очередь запрашивается заново по мере прохождения, и следующая пачка получит свою порцию.
 */
const PREPARE_AHEAD = 5;

function quizOf(q: { question: string; options: string[]; correct: number; explanation: string }): AppQuiz {
  return { question: q.question, options: q.options, correct: q.correct, explanation: q.explanation, filled: gapParts(q.question, q.options[q.correct] ?? "") };
}

/**
 * Режим тренировки: all — как /learn; reviews — только повторения; fresh — только новые слова;
 * hard — самые слабые слова, даже если ещё рано, вне зачёта (как «🔁 Потренироваться»): ответы не оцениваются.
 */
export type QueueMode = StudyScope | "hard";
export const QUEUE_MODES: QueueMode[] = ["all", "reviews", "fresh", "hard"];

async function queueItems(deps: Deps, user: User, mode: QueueMode) {
  if (mode === "hard") {
    const ids = await practiceQueue(deps.db, user.id);
    const items = await Promise.all(ids.slice(0, QUEUE_SIZE).map((id) => getDueItemByCard(deps.db, user.id, id)));
    return items.filter((i) => i !== undefined);
  }
  if (mode === "all") return dueQueue(deps.db, user.id, deps.now(), QUEUE_SIZE);
  // Отдельно повторения или новые: берём очередь с запасом и фильтруем, порядок — как в /learn.
  const wide = await dueQueue(deps.db, user.id, deps.now(), 1000);
  return wide.filter(({ card }) => (card.state === State.New) === (mode === "fresh")).slice(0, QUEUE_SIZE);
}

export async function appQueue(deps: Deps, user: User, mode: QueueMode = "all", continueExtra = false): Promise<AppItem[]> {
  const ordinary = await queueItems(deps, user, mode);
  const batch = continueExtra && ordinary.length === 0 && mode !== "hard" ? await extraQueue(deps.db, user.id, deps.now(), mode) : [];
  const extra = batch.length > 0;
  const items = extra ? batch : ordinary;
  const practice = mode === "hard";
  // Пустая карта для тренировки должна быть того же типа, что и настоящая, иначе `weak.get()`
  // становится `any` и проверка типов дальше по функции перестаёт что-либо значить.
  const weak: Awaited<ReturnType<typeof weakDirections>> = practice
    ? new Map<number, "en_ru" | "ru_en">()
    : await weakDirections(deps.db, items.map(({ card }) => card.id));
  const modes = {
    en_ru: user.modeEnRu,
    ru_en: user.modeRuEn,
    collocation: user.modeCollocation,
    cloze: user.modeCloze,
    sentence: user.modeSentence,
    listen: user.modeListen,
  };
  const mixed = modes.en_ru || modes.ru_en;
  const swipeModes = { ...modes, collocation: false, cloze: false, sentence: false, listen: false };
  const candidates = [];
  // Фоновая подготовка — только для первых карточек, а не для всей очереди. Очередь приходит пачкой
  // (до QUEUE_SIZE), и раньше на каждую карточку запускалось до трёх вызовов модели: человек открывал
  // приложение и получал десятки платных запросов, которых не просил. Генераторы дедуплицируют себя
  // по слову (`inFlight`), но не ограничивают, сколько слов берут за раз — это и делает счётчик.
  let prepared = 0;
  for (const { card, word } of items) {
    const isNew = card.state === State.New;
    const needsDecision = isNew && card.reps === 0 && card.learningPriority <= 0 && card.relearningAtLimit === null && card.triagedAt === null && word.addedBy !== user.id;
    const optional = word.usefulness === 1;
    const collocations = storedCollocations(word);
    const sentences = !extra && modes.cloze && !isNew && !optional ? await listCloze(deps.db, word.id) : [];
    // Как в /learn: упражнения на употребление готовятся в фоне, пока их нет.
    if (prepared < PREPARE_AHEAD) {
      if (!extra && !isNew && !optional && modes.collocation && !collocations) void deps.collocationGen.ensure(word);
      if (!extra && !isNew && !optional && modes.cloze && sentences.length === 0) void deps.clozeGen.ensure(word);
      // Часть речи и родня есть в карточке любого режима, даже у необязательного слова.
      void deps.grammarGen.ensure(word);
      prepared++;
    }
    // Необязательное слово — только узнавание (EN → RU); новое — с первого знакомства.
    const quizReady = Boolean(collocations?.quiz);
    const stages = !extra && mixed && !isNew && !optional ? reviewStages(card, modes, sentences.length > 0, quizReady) : [];
    const fallback = extra || optional || needsDecision
      ? "en_ru"
      : pickStage(card, mixed ? swipeModes : modes, sentences.length > 0, deps.random, quizReady, weak.get(card.id));
    candidates.push({ card, word, isNew, needsDecision, stages, fallback, sentences, collocations });
  }

  let drill: AppDrill | undefined;
  if (!extra && candidates.length >= CHOICE_INDEX && user.modeDrill && (mode === "all" || mode === "reviews") && !deps.drills.get(user.id)?.standalone) {
    ensureDrillFor(deps, user);
    const question = deps.drills.get(user.id)?.questions.shift();
    if (question) {
      rememberAsked(user.id, question.question);
      drill = { kind: "drill", id: `${deps.now().getTime()}-${CHOICE_INDEX}`, category: question.category, ...quizOf(question) };
    }
  }

  const withDrill = drill !== undefined;
  const size = Math.min(QUEUE_SIZE, candidates.length + Number(withDrill));
  const exercises = scheduleExercises(candidates.map(({ stages }) => stages), size, withDrill);
  const usedCards = new Set(Array.from(exercises.values(), ({ cardIndex }) => cardIndex));
  const remaining = candidates.filter((_, i) => !usedCards.has(i));
  const queue: AppItem[] = [];
  let nextCard = 0;
  for (let index = 0; index < size; index++) {
    if (drill && index === CHOICE_INDEX) {
      queue.push(drill);
      continue;
    }
    const exercise = exercises.get(index);
    const { card, word, isNew, needsDecision, fallback, sentences, collocations } = exercise ? candidates[exercise.cardIndex] : remaining[nextCard++];
    const stage = exercise?.stage ?? fallback;
    const cloze = stage === "cloze" ? pickCloze(sentences, card.reps) : undefined;
    queue.push({
      kind: "card",
      ...(practice ? { practice: true } : {}),
      ...(extra ? { extra: true } : {}),
      quiz: stage === "collocation" && collocations?.quiz ? { ...quizOf(collocations.quiz), items: collocations.items } : undefined,
      cloze: cloze ? { id: cloze.id, sentence: cloze.sentence, translation: cloze.translation } : undefined,
      cardId: card.id,
      reps: card.reps,
      isNew,
      ...(needsDecision ? { needsDecision: true } : {}),
      stage: stage === "cloze" && !cloze ? "en_ru" : stage,
      word: {
        id: word.id,
        term: word.term,
        translation: word.translation,
        explanation: word.explanation,
        meaningHint: reverseHint(word),
        example: word.example,
        exampleTranslation: word.exampleTranslation,
        context: word.context,
        mnemonic: word.mnemonic,
        transcriptionUk: word.transcriptionUk,
        transcriptionUs: word.transcriptionUs,
        usefulness: word.usefulness,
        hasPicture: hasPicture(deps, word),
        partOfSpeech: word.partOfSpeech,
        cefr: word.cefr,
        forms: JSON.parse(word.forms || "[]") as Array<{ form: string; label: string }>,
        synonyms: JSON.parse(word.synonyms || "[]") as Array<{ term: string; translation: string }>,
        antonyms: JSON.parse(word.antonyms || "[]") as Array<{ term: string; translation: string }>,
      },
    });
  }
  return queue;
}

/** Ответ на вопрос по ошибкам: счёт темы; отработанная тема — её оставшиеся вопросы больше не показываем. */
export async function appDrillAnswer(deps: Deps, user: User, body: { category?: unknown; correct?: unknown }) {
  if (typeof body.category !== "string" || typeof body.correct !== "boolean") {
    // Текст уходит человеку: клиент показывает `error` как есть, поэтому он по-русски и говорит,
    // что делать (E34). Техническая причина здесь не нужна — она не помогает и пугает.
    return { status: 400, body: { ok: false, error: "Не получилось разобрать ответ — вернись к вопросам и попробуй ещё раз" } };
  }
  const progress = await recordDrillAnswer(deps.db, user.id, body.category, body.correct, deps.now());
  const state = deps.drills.get(user.id);
  if (progress?.resolved && state) {
    const topic = progress.category.trim().toLowerCase();
    state.questions = state.questions.filter((q) => q.category.trim().toLowerCase() !== topic);
  }
  return { status: 200, body: { ok: true, progress: progress ?? null } };
}

type CardAnswer = Answer | "know" | "drop";
const ANSWERS = new Set<unknown>(["again", "good", "easy", "know", "drop"]);

export async function appAnswer(deps: Deps, user: User, body: { cardId?: unknown; reps?: unknown; answer?: unknown; stage?: unknown; practice?: unknown; extra?: unknown }) {
  const cardId = Number(body.cardId);
  const reps = Number(body.reps);
  const answer = body.answer as CardAnswer;
  // Задания с ответом текстом оценивает /api/check; сюда — когда проверить не вышло и человек оценил себя сам.
  const stage = typeof body.stage === "string" && ["ru_en", "collocation", "cloze", "listen", "sentence"].includes(body.stage) ? body.stage : "en_ru";
  if (!Number.isInteger(cardId) || !Number.isInteger(reps) || !ANSWERS.has(answer) || ((answer === "know" || answer === "drop") && reps !== 0)) {
    return { status: 400, body: { ok: false, error: "Не получилось разобрать ответ — обнови карточку и попробуй ещё раз" } };
  }
  // Вне зачёта — не оцениваем: расписание карточки не сдвигается.
  if (body.practice === true) return { status: 200, body: { ok: true, result: "practice", damage: 0 } };
  if (answer === "drop") {
    const dropped = await dropNewCard(deps.db, user.id, cardId);
    return { status: 200, body: { ok: true, result: dropped ? "ok" : "stale", damage: 0 } };
  }
  const result = await recordAnswer(deps.db, {
    userId: user.id,
    cardId,
    expectedReps: reps,
    answer: answer === "know" ? "easy" : answer,
    now: deps.now(),
    stage: answer === "know" ? KNOW_STAGE : `app_${stage}`,
    extra: body.extra === true,
  });
  return { status: 200, body: { ok: true, ...result } };
}

/** Своё слово: только из карточек этого человека — чужие слова через API не достать. */
export async function ownWord(deps: Deps, user: User, cardId: number): Promise<Word | undefined> {
  return (await getDueItemByCard(deps.db, user.id, cardId))?.word;
}

/** Озвучка в AAC для браузера, кэш на диске. */
/** key — чей звук в кэше: id слова, а для слова из набора — «set<id>» (оно ещё не в словаре). */
export async function appAudio(deps: Deps, word: { id: number | string; term: string }, accent: "uk" | "us"): Promise<Buffer> {
  const file = join(AUDIO_DIR, `${word.id}-${accent}-${Buffer.from(word.term).toString("hex").slice(0, 24)}.m4a`);
  if (existsSync(file)) return readFile(file);
  // Слово словаря — на языке своей комнаты; слово из набора — на языке текущей операции.
  const audio = await deps.speech.synthesize(word.term, accent, "m4a");
  await mkdir(AUDIO_DIR, { recursive: true });
  await writeFile(file, audio);
  return audio;
}

/**
 * Картинка слова для Mini App: нарисованная (уже сжатая при генерации) — с диска; отправленная в Telegram раньше,
 * до сжатия, — скачиваем по file_id один раз, сжимаем и кладём на диск.
 */
export async function appPicture(deps: Deps, api: Api | undefined, word: Word): Promise<Buffer | undefined> {
  const onDisk = deps.pictures?.find(word);
  if (onDisk?.endsWith(".jpg")) return readFile(onDisk);
  const original = onDisk ? await readFile(onDisk) : await fromTelegram(api, word);
  if (!original) return undefined;
  const jpeg = await compressPicture(original);
  await deps.pictures?.save(word, jpeg);
  return jpeg;
}

async function fromTelegram(api: Api | undefined, word: Word): Promise<Buffer | undefined> {
  if (!word.imageFileId || !api) return undefined;
  const file = await api.getFile(word.imageFileId);
  if (!file.file_path) return undefined;
  const response = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`);
  return response.ok ? Buffer.from(await response.arrayBuffer()) : undefined;
}

/** 📊 Прогресс: серия, выучено, календарь занятий, прогноз повторений, цель комнаты, темы ошибок. */
export async function appProgress(deps: Deps, user: User) {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  return progressReport(deps.db, user, room, deps.now());
}

/**
 * 🐉 Вкладка босса: состояние боя и лента ударов.
 *
 * `enabled: false` — человек выключил режим: приложение тогда не показывает вкладку вовсе, но данные
 * отдаём, чтобы включение не требовало перезагрузки. Считается всё тем же `goalProgress`, что у /goal.
 */
export async function appBoss(deps: Deps, user: User) {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  const enabled = bossEnabled(user, deps.bossEnabled);
  // Рубильник или личный режим выключены — состояния не считаем: приложение всё равно ничего не покажет.
  if (!enabled) return { enabled, boss: undefined, hits: [], total: 0 };
  if (!room) return { enabled, boss: undefined };
  const now = deps.now();
  const boss = await bossOf(deps.db, room, now, user.id);
  // Победа — «на этой неделе комнату добивали», а не «сейчас добит»: добитый босс сразу уступает место
  // следующему, поэтому `phase === "dead"` в состоянии не наступает вовсе.
  const won = boss.kills > 0;
  // Копилка до чтения монет: остаток прошлой недели переезжает в неё, иначе прокачка застынет навсегда.
  await settledBank(deps.db, user.id, now);
  const [feed, combat, earnedCoins, collection, members] = await Promise.all([
    bossFeed(deps.db, room, now, 20, won ? boss.target : undefined),
    combatState(deps.db, user, now, boss),
    personalDamage(deps.db, user.id, now),
    userTrophies(deps.db, user.id),
    won ? deps.db.select({ id: roomMembers.userId }).from(roomMembers).where(eq(roomMembers.roomId, room.id)).limit(2) : [],
  ]);
  // 🪙 Монеты — личный урон этой недели: усиление своё, чужой урон монет не даёт.
  const coins = coinState(earnedCoins, user, now);
  return {
    enabled,
    combat: { ...combat, roomId: room.id, week: boss.week, bank: true },
    coins,
    ...(won ? {
      victory: {
        ...(feed.finalBlow ? { finalBlow: { name: feed.finalBlow.name, at: feed.finalBlow.at.toISOString() } } : {}),
        teamTrophy: members.length > 1,
      },
    } : {}),
    trophies: {
      // Отдаём весь каталог: вкладка показывает и то, чего ещё нет, — иначе коллекция не коллекция.
      all: TROPHIES.map((t) => ({ kind: t.kind, emoji: t.emoji, title: t.title, how: t.how })),
      earned: collection.earned.map((e) => ({ kind: e.def.kind, count: e.count, lastWeek: e.lastWeek })),
      total: collection.total,
      of: collection.of,
    },
    boss: {
      room: boss.room,
      opponent: boss.opponent,
      nextOpponent: boss.nextOpponent,
      week: boss.week,
      damage: boss.damage,
      hp: boss.hp,
      target: boss.target,
      done: boss.done,
      phase: boss.phase,
      pace: boss.pace,
      daysLeft: boss.daysLeft,
      // Какой по счёту босс на этой неделе: добили — на арене сразу следующий, другой и толще.
      round: boss.round,
      kills: boss.kills,
      progress: boss.progress,
      // HP текущего босса: у второй ступени он толще первой, и полоска должна считать по нему.
      bossHp: boss.bossHp,
      // Ступень ладдера и круг — из них видно, что боссы те же, а глубина растёт.
      tier: boss.tier,
      cycle: boss.cycle,
      // Пояс комнаты: клиент подписывает им время конца недели, а не зашитым «по Новосибирску».
      timeZone: boss.timeZone,
      // Показываем коротким форматом: вкладке нужно «сколько мне снимать», а не весь отчёт.
      byUser: boss.byUser,
    },
    hits: feed.hits.map((hit) => ({ name: hit.name, damage: hit.damage, at: hit.at.toISOString() })),
    total: feed.total,
  };
}

export async function appCombat(deps: Deps, user: User, input: {
  bank?: unknown; target?: unknown; roomId?: unknown; week?: unknown; requestId?: unknown; maxDamageDeci?: unknown;
} | null) {
  if (!bossEnabled(user, deps.bossEnabled)) return { status: 400 as const, body: { ok: false, error: "Режим босса выключен" } };
  if (typeof input?.bank === "boolean") {
    return { status: 410 as const, body: { ok: false, error: "Энергия теперь копится автоматически. Переоткрой Mini App." } };
  }
  if (input?.target === "boss") {
    return { status: 409 as const, body: { ok: false, error: "Открой Mini App заново и начни атаку на арене." } };
  }
  if (!input || !isMobTarget(input.target)
    || typeof input.roomId !== "number" || !Number.isSafeInteger(input.roomId) || typeof input.week !== "string"
    || typeof input.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.requestId)
    || typeof input.maxDamageDeci !== "number" || !Number.isSafeInteger(input.maxDamageDeci) || input.maxDamageDeci <= 0) {
    return { status: 400 as const, body: { ok: false, error: "Выбери цель для удара" } };
  }
  const { target, roomId, week, requestId, maxDamageDeci } = input;
  const damage = await attackWithReserve(deps.db, user.id, { target, roomId, week, requestId, maxDamageDeci }, deps.now);
  const fresh = await getUserByTelegramId(deps.db, user.telegramId);
  if (!fresh) return { status: 400 as const, body: { ok: false, error: "Пользователь недоступен" } };
  return { status: 200 as const, body: { ok: true, ...(damage === undefined ? { notice: "Удар не прошёл. Проверь цель и запас." } : { damage }), ...await appBoss(deps, fresh) } };
}

/**
 * 📦 Наборы: список с прогрессом и куда сейчас идут слова.
 *
 * `target` отдаём всегда: приложение показывает его в заголовке («слова пойдут в …») и спрашивает
 * один раз, если человек ещё не выбирал. `needsChoice` — есть выбор из чего выбирать и он не сделан.
 */
export async function appSets(deps: Deps, user: User) {
  const lang = EN.code;
  const [target, choices] = await Promise.all([
    setTarget(deps.db, user, lang, deps.now()),
    setTargetChoices(deps.db, user),
  ]);
  return {
    target: { roomId: target.roomId, roomName: target.roomName, personal: target.personal },
    // Спрашиваем один раз и только если выбор осмысленный: одна комната — выбирать не из чего.
    needsChoice: user.setTargetRoomId == null && choices.length > 1,
    rooms: choices.map((c) => ({ roomId: c.roomId, roomName: c.roomName, personal: c.personal, current: c.roomId === target.roomId })),
    sets: (await listSets(deps.db, user.id)).map(({ set, total, done }) => ({
      id: set.id,
      title: set.title,
      description: set.description,
      kind: set.kind,
      total,
      done,
    })),
  };
}

/** Куда «учу» кладёт слово в этом наборе — приложение показывает это до первого свайпа. */
export async function appSetTarget(deps: Deps, user: User) {
  const lang = EN.code;
  const [target, choices] = await Promise.all([
    setTarget(deps.db, user, lang, deps.now()),
    setTargetChoices(deps.db, user),
  ]);
  return {
    ok: true as const,
    target: { roomId: target.roomId, roomName: target.roomName, personal: target.personal },
    needsChoice: user.setTargetRoomId == null && choices.length > 1,
    rooms: choices.map((c) => ({ roomId: c.roomId, roomName: c.roomName, personal: c.personal, current: c.roomId === target.roomId })),
  };
}

/** Сменить комнату для слов из наборов. Ошибка — текстом для человека. */
export async function appSetSetTarget(deps: Deps, user: User, body: { roomId?: unknown }) {
  const roomId = Number(body.roomId);
  if (!Number.isInteger(roomId)) return { status: 400 as const, body: { ok: false as const, error: "Не понял, о какой комнате речь — обнови экран" } };
  const result = await setSetTarget(deps.db, user, roomId);
  if (!result.ok) return { status: 409 as const, body: { ok: false as const, error: result.error } };
  const fresh = await getUserByTelegramId(deps.db, user.telegramId);
  return { status: 200 as const, body: await appSetTarget(deps, fresh ?? user) };
}

export async function appSetItems(deps: Deps, user: User, setId: number) {
  const [set] = await deps.db.select().from(wordSets).where(eq(wordSets.id, setId));
  if (!set) return undefined;
  const left = await nextSetItems(deps.db, user.id, setId, 10_000);
  const items = left.slice(0, 50);
  return {
    set: { id: set.id, title: set.title },
    /** Сколько всего осталось разобрать (слова приходят порциями). */
    remaining: left.length,
    items: items.map((i) => ({
      id: i.id,
      term: i.term,
      translation: i.translation,
      explanation: i.explanation,
      example: i.example,
      transcriptionUk: i.transcriptionUk,
      transcriptionUs: i.transcriptionUs,
      usefulness: i.usefulness,
    })),
  };
}

const SET_DECISIONS = new Set<SetDecision>(["learn", "know", "drop"]);

export async function appSetDecide(deps: Deps, user: User, body: { itemId?: unknown; decision?: unknown; undo?: unknown }) {
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId)) return { status: 400, body: { ok: false, error: "Не понял, о каком слове речь — обнови экран" } };
  if (body.undo === true) {
    const ok = await undoDecision(deps.db, { userId: user.id, itemId });
    return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "Уже неактуально" } };
  }
  const decision = String(body.decision) as SetDecision;
  if (!SET_DECISIONS.has(decision)) return { status: 400, body: { ok: false, error: "Не понял выбор — обнови экран и попробуй ещё раз" } };
  const ok = await decide(deps.db, { user, itemId, decision, now: deps.now() });
  return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "Уже разобрано" } };
}

/** Слово набора для озвучки (до «учу» его нет в словаре). */
export async function setItemForAudio(deps: Deps, itemId: number) {
  const [item] = await deps.db.select().from(setItems).where(eq(setItems.id, itemId));
  return item ? { id: `set${item.id}`, term: item.term } : undefined;
}

/** 🪙 Покупка усиления: проверяем монеты на сервере — доверять числу с телефона нельзя. */
export async function appBuyUpgrade(deps: Deps, user: User, body: unknown = {}) {
  const kind = body && typeof body === "object" && "kind" in body ? body.kind : "damage";
  const upgrade = UPGRADES.find((u) => u.kind === kind);
  if (kind !== "rune" && !upgrade) return { status: 400, body: { ok: false as const, error: "Неизвестное усиление" } };
  if (!bossEnabled(user, deps.bossEnabled)) return { status: 400, body: { ok: false as const, error: "Босс выключен" } };
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  if (!room) return { status: 400, body: { ok: false as const, error: "Нет комнаты" } };
  const now = deps.now();
  const result = upgrade
    ? await buyUpgrade(deps.db, user.id, await personalDamage(deps.db, user.id, now), now, upgrade.kind)
    : await buyPiercingRune(deps.db, user.id, deps.now);
  if (result === "max") return { status: 400, body: { ok: false as const, error: "Дальше усиление не растёт" } };
  if (result === "poor") return { status: 400, body: { ok: false as const, error: "Пока не хватает монет — снятых HP этой недели" } };
  if (result === "owned") return { status: 400, body: { ok: false as const, error: "Руна уже в запасе" } };
  if (result === "stale") return { status: 400, body: { ok: false as const, error: "Покупка не прошла. Проверь баланс." } };
  // Обновлённый пользователь: ответ должен показывать новый уровень, а не тот, что был на входе.
  return { status: 200, body: { ok: true as const }, user: (await getUserByTelegramId(deps.db, user.telegramId)) ?? user };
}

/**
 * 📘 Грамматика в приложении: темы, тема целиком и проверка ответа.
 *
 * Проверка серверная и **без модели** — тот же `answerExercise`, что в боте: сравнение строк с ответом
 * из базы. Поэтому приложение не может «подсказать» себе правильный вариант, а промах попадает в общую
 * работу над ошибками, а верный ответ может начислить энергию.
 */
export async function appGrammar(deps: Deps, user: User) {
  const topics = await listTopics(deps.db, user.id);
  // Сколько тем сдано — отдельным числом, чтобы экран не пересчитывал сам.
  const passed = topics.filter((t) => t.passed).length;
  return { topics, passed, total: topics.length };
}

export async function appGrammarTopic(deps: Deps, user: User, topicId: number) {
  return topicView(deps.db, user.id, topicId);
}

/**
 * Ответ на упражнение. Энергия начисляется в общий запас.
 * `ok: false` — упражнения нет (контент обновили, пока экран был открыт).
 */
export async function appGrammarAnswer(deps: Deps, user: User, body: unknown) {
  const input = body && typeof body === "object" ? body as { exerciseId?: unknown; answer?: unknown } : {};
  const exerciseId = Number(input.exerciseId);
  if (!Number.isInteger(exerciseId)) return { status: 400 as const, body: { ok: false as const, error: "Не выбрано упражнение" } };
  if (typeof input.answer !== "string") return { status: 400 as const, body: { ok: false as const, error: "Нет ответа" } };
  const result = await answerExercise(deps.db, {
    userId: user.id,
    exerciseId,
    answer: input.answer,
    now: deps.now(),
    globalBossEnabled: deps.bossEnabled,
  });
  if (!result) return { status: 404 as const, body: { ok: false as const, error: "Упражнение не найдено — возможно, контент обновили" } };
  return { status: 200 as const, body: { ok: true as const, result } };
}

export async function appGrammarAsk(deps: Deps, user: User, body: Record<string, unknown>) {
  const { exerciseId } = body;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (typeof exerciseId !== "number" || !Number.isSafeInteger(exerciseId) || exerciseId <= 0 || !question || question.length > 400) {
    return { status: 400 as const, body: { ok: false, error: "Напиши вопрос до 400 символов." } };
  }
  const data = await grammarExerciseWithTopic(deps.db, exerciseId);
  if (!data) return { status: 404 as const, body: { ok: false, error: "Упражнение не найдено. Открой тему заново." } };
  const tutor = deps.tutor;
  if (!tutor.explainGrammar) return { status: 503 as const, body: { ok: false, error: "Ответы ИИ пока недоступны." } };
  const quota = await checkAndCount(deps.db, { kind: "grammar_ask", userId: user.id, timeZone: user.timezone, now: deps.now() });
  if (!quota.allowed) return { status: 429 as const, body: { ok: false, error: quota.refusal } };

  const learnerAnswer = typeof body.learnerAnswer === "string" ? body.learnerAnswer.trim().slice(0, 400) : "";
  try {
    const explanation = (await tutor.explainGrammar({ ...explanationPrompt(data.topic, data.exercise), question, learnerAnswer })).trim();
    if (explanation) return { status: 200 as const, body: { ok: true, explanation } };
  } catch {
    console.error("App grammar question failed");
  }
  return { status: 503 as const, body: { ok: false, error: "Не удалось получить ответ ИИ. Попробуй ещё раз." } };
}
