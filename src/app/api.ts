import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Api } from "grammy";
import { compressPicture } from "../images/compress";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import type { User, Word } from "../db/schema";
import { cardView } from "../services/card-view";
import { ensureDrillFor, rememberAsked } from "../bot/handlers/drill";
import { gapParts } from "../bot/texts";
import { storedCollocations } from "../services/collocations";
import { pickStage } from "../services/exercises";
import { recordDrillAnswer } from "../services/mistakes";
import { triage, triageCount, triageQueue, undoTriage, type TriageAction } from "../services/triage";
import { answerCard, countDueSplit, dueQueue, getDueItemByCard } from "../services/review";
import { getRoom } from "../services/rooms";
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
  cardId: number;
  reps: number;
  isNew: boolean;
  /** EN → RU (видно слово), RU → EN (видно перевод) или 🔗 сочетания (вопрос с вариантами). */
  stage: "en_ru" | "ru_en" | "collocation";
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

export async function appUser(deps: Pick<Deps, "db">, telegramId: number): Promise<User | undefined> {
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
export async function appQueue(deps: Deps, user: User): Promise<AppItem[]> {
  const items = await dueQueue(deps.db, user.id, deps.now(), QUEUE_SIZE);
  const modes = { en_ru: user.modeEnRu, ru_en: user.modeRuEn, collocation: user.modeCollocation, cloze: false, sentence: false, listen: false };
  const cards: AppCard[] = items.map(({ card, word }) => {
    const isNew = card.state === State.New;
    const collocations = storedCollocations(word);
    const picked = isNew || word.usefulness === 1 ? (user.modeEnRu || isNew ? "en_ru" : "ru_en") : pickStage(card, modes, false, deps.random, Boolean(collocations?.quiz));
    const stage = picked === "ru_en" || picked === "collocation" ? picked : "en_ru";
    if (!isNew && word.usefulness !== 1 && modes.collocation && !collocations) void deps.collocationGen.ensure(word);
    return {
      kind: "card",
      quiz: stage === "collocation" && collocations?.quiz ? { ...quizOf(collocations.quiz), items: collocations.items } : undefined,
      cardId: card.id,
      reps: card.reps,
      isNew,
      stage,
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
    };
  });
  // Вопросы по ошибкам готовятся в фоне (как в /learn); готовые — между карточками.
  ensureDrillFor(deps, user);
  const drills = user.modeDrill ? deps.drills.get(user.id) : undefined;
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

export async function appAnswer(deps: Deps, user: User, body: { cardId?: unknown; reps?: unknown; answer?: unknown; stage?: unknown }) {
  const cardId = Number(body.cardId);
  const reps = Number(body.reps);
  const answer = String(body.answer) as Answer;
  const stage = body.stage === "ru_en" || body.stage === "collocation" ? body.stage : "en_ru";
  if (!Number.isInteger(cardId) || !Number.isInteger(reps) || !ANSWERS.has(answer)) return { status: 400, body: { ok: false, error: "bad answer" } };
  const result = await answerCard(deps.db, { userId: user.id, cardId, expectedReps: reps, answer, now: deps.now(), stage: `app_${stage}` });
  return { status: 200, body: { ok: true, result } };
}

/** Своё слово: только из карточек этого человека — чужие слова через API не достать. */
export async function ownWord(deps: Deps, user: User, cardId: number): Promise<Word | undefined> {
  return (await getDueItemByCard(deps.db, user.id, cardId))?.word;
}

/** Озвучка в AAC для браузера, кэш на диске. */
export async function appAudio(deps: Deps, word: Word, accent: "uk" | "us"): Promise<Buffer> {
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
