import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Api } from "grammy";
import { compressPicture } from "../images/compress";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import type { User, Word } from "../db/schema";
import { cardView } from "../services/card-view";
import { answerCard, countDueSplit, dueQueue, getDueItemByCard } from "../services/review";
import { getRoom } from "../services/rooms";
import { getUserByTelegramId } from "../services/users";
import type { Answer } from "../srs/srs";

/** Сколько карточек отдавать за раз: приложение показывает их без ожидания, ответы шлёт в фоне. */
const QUEUE_SIZE = 20;
const AUDIO_DIR = resolve("data/audio");

export interface AppCard {
  cardId: number;
  reps: number;
  isNew: boolean;
  /** EN → RU (видно слово) или RU → EN (видно перевод). */
  stage: "en_ru" | "ru_en";
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
  return { name: user.firstName, room: room?.name ?? null, due: await countDueSplit(deps.db, user.id, deps.now()), view: cardView(user) };
}

function hasPicture(deps: Deps, word: Word): boolean {
  return Boolean(word.imageFileId || deps.pictures?.find(word));
}

/** Очередь карточек: тот же порядок, что в /learn. Вид — как там: новое и необязательное слово — EN → RU, остальное — случайно. */
export async function appQueue(deps: Deps, user: User): Promise<AppCard[]> {
  const items = await dueQueue(deps.db, user.id, deps.now(), QUEUE_SIZE);
  return items.map(({ card, word }) => {
    const isNew = card.state === State.New;
    const both = user.modeEnRu && user.modeRuEn;
    const stage = isNew || word.usefulness === 1 || !both ? (user.modeEnRu || isNew ? "en_ru" : "ru_en") : deps.random() < 0.5 ? "en_ru" : "ru_en";
    return {
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
}

const ANSWERS = new Set<Answer>(["again", "good", "easy"]);

export async function appAnswer(deps: Deps, user: User, body: { cardId?: unknown; reps?: unknown; answer?: unknown; stage?: unknown }) {
  const cardId = Number(body.cardId);
  const reps = Number(body.reps);
  const answer = String(body.answer) as Answer;
  const stage = body.stage === "ru_en" ? "ru_en" : "en_ru";
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
