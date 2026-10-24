import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Api } from "grammy";
import { compressPicture } from "../images/compress";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import type { User, Word } from "../db/schema";
import { cardView } from "../services/card-view";
import { decide, listSets, nextSetItems, undoDecision, type SetDecision } from "../services/word-sets";
import { setItems, wordSets } from "../db/schema";
import { eq } from "drizzle-orm";
import { progressReport } from "../services/progress";
import { ensureDrillFor, rememberAsked } from "../bot/handlers/drill";
import { gapParts } from "../bot/texts";
import { storedCollocations } from "../services/collocations";
import { pickStage } from "../services/exercises";
import { listCloze, pickCloze } from "../services/cloze";
import { recordDrillAnswer } from "../services/mistakes";
import { triage, triageCount, triageQueue, undoTriage, type TriageAction } from "../services/triage";
import { answerCard, countDueSplit, dueQueue, getDueItemByCard } from "../services/review";
import { practiceQueue } from "../services/practice";
import { ensurePersonalRoom, getRoom } from "../services/rooms";
import { getUserByTelegramId } from "../services/users";
import type { Answer } from "../srs/srs";

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
  cardId: number;
  reps: number;
  isNew: boolean;
  /** EN → RU, RU → EN, 🔗 сочетания (варианты) или задание с ответом текстом: вставь по смыслу, диктант, своё предложение. */
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
    example: string;
    context: string;
    mnemonic: string;
    transcriptionUk: string;
    transcriptionUs: string;
    usefulness: number | null;
    hasPicture: boolean;
  };
}

export async function appUser(deps: Pick<Deps, "db" | "now">, telegramId: number): Promise<User | undefined> {
  const user = await getUserByTelegramId(deps.db, telegramId);
  if (!user || user.currentRoomId != null) return user;
  // Как в боте: без комнаты — личный словарь, а не «сначала выбери комнату».
  await ensurePersonalRoom(deps.db, user.id, deps.now());
  return getUserByTelegramId(deps.db, telegramId);
}

export async function appMe(deps: Deps, user: User) {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  return {
    name: user.firstName,
    room: room?.name ?? null,
    due: await countDueSplit(deps.db, user.id, deps.now()),
    view: cardView(user),
    triage: await triageCount(deps.db, user.id),
  };
}

function hasPicture(deps: Deps, word: Word): boolean {
  return Boolean(word.imageFileId || deps.pictures?.find(word));
}

/** 🧠 Вопрос по ошибкам, подмешанный в очередь (как в /learn — после каждых DRILL_EVERY карточек). */
export interface AppDrill extends AppQuiz {
  kind: "drill";
  id: string;
  category: string;
}

export type AppItem = AppCard | AppDrill;

const DRILL_EVERY = 5;

function quizOf(q: { question: string; options: string[]; correct: number; explanation: string }): AppQuiz {
  return { question: q.question, options: q.options, correct: q.correct, explanation: q.explanation, filled: gapParts(q.question, q.options[q.correct] ?? "") };
}

/**
 * Очередь: тот же порядок, что в /learn. Вид — как там: новое и необязательное слово — EN → RU, остальное — случайно
 * из того, что умеет приложение (EN → RU, RU → EN, сочетания), и после каждых 5 карточек — вопрос по ошибкам, если готов.
 */
/**
 * Режим тренировки: all — как /learn; reviews — только повторения; fresh — только новые слова;
 * hard — самые слабые слова, даже если ещё рано, вне зачёта (как «🔁 Потренироваться»): ответы не оцениваются.
 */
export type QueueMode = "all" | "reviews" | "fresh" | "hard";
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

export async function appQueue(deps: Deps, user: User, mode: QueueMode = "all"): Promise<AppItem[]> {
  const items = await queueItems(deps, user, mode);
  const practice = mode === "hard";
  const modes = {
    en_ru: user.modeEnRu,
    ru_en: user.modeRuEn,
    collocation: user.modeCollocation,
    cloze: user.modeCloze,
    sentence: user.modeSentence,
    listen: user.modeListen,
  };
  const cards: AppCard[] = [];
  for (const { card, word } of items) {
    const isNew = card.state === State.New;
    const optional = word.usefulness === 1;
    const collocations = storedCollocations(word);
    const sentences = modes.cloze && !isNew && !optional ? await listCloze(deps.db, word.id) : [];
    // Как в /learn: упражнения на употребление готовятся в фоне, пока их нет.
    if (!isNew && !optional && modes.collocation && !collocations) void deps.collocationGen.ensure(word);
    if (!isNew && !optional && modes.cloze && sentences.length === 0) void deps.clozeGen.ensure(word);
    // Необязательное слово — только узнавание (EN → RU); новое — с первого знакомства.
    const stage = optional
      ? "en_ru"
      : pickStage(card, modes, sentences.length > 0, deps.random, Boolean(collocations?.quiz));
    const cloze = stage === "cloze" ? pickCloze(sentences, card.reps) : undefined;
    cards.push({
      kind: "card",
      ...(practice ? { practice: true } : {}),
      quiz: stage === "collocation" && collocations?.quiz ? { ...quizOf(collocations.quiz), items: collocations.items } : undefined,
      cloze: cloze ? { id: cloze.id, sentence: cloze.sentence, translation: cloze.translation } : undefined,
      cardId: card.id,
      reps: card.reps,
      isNew,
      stage: stage === "cloze" && !cloze ? "en_ru" : stage,
      word: {
        id: word.id,
        term: word.term,
        translation: word.translation,
        explanation: word.explanation,
        example: word.example,
        context: word.context,
        mnemonic: word.mnemonic,
        transcriptionUk: word.transcriptionUk,
        transcriptionUs: word.transcriptionUs,
        usefulness: word.usefulness,
        hasPicture: hasPicture(deps, word),
      },
    });
  }
  // Вопросы по ошибкам готовятся в фоне (как в /learn); готовые — между карточками (во «Всё» и «Повторениях»).
  ensureDrillFor(deps, user);
  const drills = user.modeDrill && (mode === "all" || mode === "reviews") ? deps.drills.get(user.id) : undefined;
  const queue: AppItem[] = [];
  cards.forEach((card, i) => {
    queue.push(card);
    const q = (i + 1) % DRILL_EVERY === 0 && drills && !drills.standalone ? drills.questions.shift() : undefined;
    if (q) {
      rememberAsked(user.id, q.question);
      queue.push({ kind: "drill", id: `${Date.now()}-${i}`, category: q.category, ...quizOf(q) });
    }
  });
  return queue;
}

/** Ответ на вопрос по ошибкам: счёт темы; отработанная тема — её оставшиеся вопросы больше не показываем. */
export async function appDrillAnswer(deps: Deps, user: User, body: { category?: unknown; correct?: unknown }) {
  if (typeof body.category !== "string" || typeof body.correct !== "boolean") return { status: 400, body: { ok: false, error: "bad answer" } };
  const progress = await recordDrillAnswer(deps.db, user.id, body.category, body.correct, deps.now());
  const state = deps.drills.get(user.id);
  if (progress?.resolved && state) {
    const topic = progress.category.trim().toLowerCase();
    state.questions = state.questions.filter((q) => q.category.trim().toLowerCase() !== topic);
  }
  return { status: 200, body: { ok: true, progress: progress ?? null } };
}

const ANSWERS = new Set<Answer>(["again", "good", "easy"]);

export async function appAnswer(deps: Deps, user: User, body: { cardId?: unknown; reps?: unknown; answer?: unknown; stage?: unknown; practice?: unknown }) {
  const cardId = Number(body.cardId);
  const reps = Number(body.reps);
  const answer = String(body.answer) as Answer;
  // Задания с ответом текстом оценивает /api/check; сюда — когда проверить не вышло и человек оценил себя сам.
  const stage = typeof body.stage === "string" && ["ru_en", "collocation", "cloze", "listen", "sentence"].includes(body.stage) ? body.stage : "en_ru";
  if (!Number.isInteger(cardId) || !Number.isInteger(reps) || !ANSWERS.has(answer)) return { status: 400, body: { ok: false, error: "bad answer" } };
  // Вне зачёта — не оцениваем: расписание карточки не сдвигается.
  if (body.practice === true) return { status: 200, body: { ok: true, result: "practice" } };
  const result = await answerCard(deps.db, { userId: user.id, cardId, expectedReps: reps, answer, now: deps.now(), stage: `app_${stage}` });
  return { status: 200, body: { ok: true, result } };
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

/** 🆕 Новые слова от друзей — колода на разбор: карточка слова и кто его добавил. */
export async function appTriageQueue(deps: Deps, user: User) {
  const items = await triageQueue(deps.db, user.id);
  return items.map(({ card, word, addedBy }) => ({
    cardId: card.id,
    addedBy,
    word: {
      id: word.id,
      term: word.term,
      translation: word.translation,
      explanation: word.explanation,
      example: word.example,
      context: word.context,
      mnemonic: word.mnemonic,
      transcriptionUk: word.transcriptionUk,
      transcriptionUs: word.transcriptionUs,
      usefulness: word.usefulness,
      hasPicture: hasPicture(deps, word),
    },
  }));
}

const TRIAGE_ACTIONS = new Set<TriageAction>(["learn", "know", "drop"]);

export async function appTriage(deps: Deps, user: User, body: { cardId?: unknown; wordId?: unknown; action?: unknown; undo?: unknown }) {
  const action = String(body.action) as TriageAction;
  const cardId = Number(body.cardId);
  if (!TRIAGE_ACTIONS.has(action) || !Number.isInteger(cardId)) return { status: 400, body: { ok: false, error: "bad action" } };
  const now = deps.now();
  const ok = body.undo
    ? await undoTriage(deps.db, { userId: user.id, cardId, wordId: Number(body.wordId), action, now })
    : await triage(deps.db, { userId: user.id, cardId, action, now });
  return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "Уже неактуально" } };
}

/** 📊 Прогресс: серия, выучено, календарь занятий, прогноз повторений, цель комнаты, темы ошибок. */
export async function appProgress(deps: Deps, user: User) {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  return progressReport(deps.db, user, room, deps.now());
}

/** 📦 Наборы: список с прогрессом, следующие слова набора, решение по слову (или его отмена). */
export async function appSets(deps: Deps, user: User) {
  return (await listSets(deps.db, user.id)).map(({ set, total, done }) => ({
    id: set.id,
    title: set.title,
    description: set.description,
    kind: set.kind,
    total,
    done,
  }));
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
  if (!Number.isInteger(itemId)) return { status: 400, body: { ok: false, error: "bad item" } };
  if (body.undo === true) {
    const ok = await undoDecision(deps.db, { userId: user.id, itemId });
    return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "Уже неактуально" } };
  }
  const decision = String(body.decision) as SetDecision;
  if (!SET_DECISIONS.has(decision)) return { status: 400, body: { ok: false, error: "bad decision" } };
  const ok = await decide(deps.db, { userId: user.id, itemId, decision, now: deps.now() });
  return ok ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "Уже разобрано" } };
}

/** Слово набора для озвучки (до «учу» его нет в словаре). */
export async function setItemForAudio(deps: Deps, itemId: number) {
  const [item] = await deps.db.select().from(setItems).where(eq(setItems.id, itemId));
  return item ? { id: `set${item.id}`, term: item.term } : undefined;
}
