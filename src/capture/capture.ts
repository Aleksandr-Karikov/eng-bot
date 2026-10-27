import { rateUsefulness } from "../services/usefulness";
import { and, eq } from "drizzle-orm";
import type { Deps } from "../bot/context";
import { captureKeyboard } from "../bot/keyboards";
import { captureText } from "../bot/texts";
import { broadcastWord } from "../bot/word-flow";
import { cards, users, words, type User, type Word } from "../db/schema";
import { findWord, getWord, MAX_CONTEXT, saveWord } from "../services/words";
import { checkAndCountWord, QUOTAS, wordsLeft } from "../services/limits";
import { ensurePersonalRoom, getRoom, isMember, listMembers } from "../services/rooms";
import { isLangCode, withLang } from "../lang";

/** Что прислало расширение: выделенное слово или фраза и реплика, где оно встретилось. */
export interface CaptureInput {
  key: string;
  /** Выделенное; пусто — взять всю реплику и пусть Claude выберет, что учить. */
  text?: string;
  /** Реплика субтитров целиком. */
  context?: string;
  /** Название сериала/фильма со страницы. */
  title?: string;
}

export type CaptureResult =
  | { ok: true; added: Array<{ term: string; translation: string }>; duplicates: string[] }
  | { ok: false; status: number; error: string };

const MAX_TERM = 120;

/** Кавычки, тире и знаки по краям выделения — не часть слова. */
export function cleanSelection(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’«»(\[—–-]+|[\s"'“”‘’«»)\].,!?;:…—–-]+$/gu, "")
    .trim();
}

export async function userByCaptureKey(deps: Pick<Deps, "db">, key: string): Promise<User | undefined> {
  if (!key) return undefined;
  const [user] = await deps.db.select().from(users).where(eq(users.captureKey, key));
  return user;
}

/**
 * Добавляет слово из расширения сразу, без черновика: перевод — в значении из реплики, реплика — контекст (📍).
 * Автору — сообщение с «↩️ Отменить», друзьям — сразу, как обычное новое слово: «знаешь?» с кнопками.
 */
export async function capture(deps: Deps, input: CaptureInput): Promise<CaptureResult> {
  const user = await userByCaptureKey(deps, input.key);
  if (!user) return { ok: false, status: 401, error: "Неверный ключ — возьми новый в боте: /extension" };
  // Без комнаты — в личный словарь.
  const roomId = user.currentRoomId ?? (await ensurePersonalRoom(deps.db, user.id, deps.now())).id;
  // Перевод и подсказки — на языке комнаты, куда слово попадёт.
  return withLang(await roomLanguage(deps, roomId), () => captureInto(deps, input, user, roomId));
}

async function roomLanguage(deps: Deps, roomId: number | null) {
  const room = roomId != null ? await getRoom(deps.db, roomId) : undefined;
  return isLangCode(room?.language) ? room.language : "en";
}

async function captureInto(deps: Deps, input: CaptureInput, user: User, roomId: number): Promise<CaptureResult> {
  const context = (input.context ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT);
  const selection = cleanSelection(input.text ?? "");
  if (!selection && !context) return { ok: false, status: 400, error: "Нечего добавлять" };
  if (selection.length > MAX_TERM) return { ok: false, status: 400, error: "Слишком длинное выделение — выбери слово или фразу" };

  // Ничего не выделено (или выделена вся реплика) — Claude выбирает из неё, что стоит учить.
  const wholeLine = !selection || selection === cleanSelection(context);
  let drafts: Array<{ term: string; translation: string; explanation: string; example: string; transcriptionUk?: string; transcriptionUs?: string }>;
  try {
    const raw = wholeLine ? await deps.enricher.extract(context) : [{ term: selection, ...(await deps.enricher.enrich(selection, undefined, context || undefined)) }];
    drafts = await rateUsefulness(raw, deps.frequency);
  } catch (err) {
    console.error("Capture enrichment failed", err);
    return { ok: false, status: 502, error: "Не получилось перевести — попробуй ещё раз" };
  }

  const added: Word[] = [];
  const duplicates: string[] = [];
  // Лимит на слова — до разбора реплики: расширение ловит субтитры пачками, и если человек упёрся,
  // честнее отказать сразу, чем звать модель на каждую реплику и потом ничего не сохранить.
  const left = await wordsLeft(deps.db, { userId: user.id, timeZone: user.timezone, now: deps.now() });
  if (left.left <= 0) return { ok: false, status: 429, error: QUOTAS[left.kind].refusal };
  for (const draft of drafts) {
    if (added.length >= left.left) break;
    if (await findWord(deps.db, roomId, draft.term)) {
      duplicates.push(draft.term);
      continue;
    }
    const result = await saveWord(deps.db, { roomId, addedBy: user.id, draft: { ...draft, mnemonic: "", context }, now: deps.now() });
    if (result.status !== "saved") continue;
    // Расход — за каждое сохранённое: дубль места не занимает.
    await checkAndCountWord(deps.db, { userId: user.id, timeZone: user.timezone, now: deps.now() });
    added.push(result.word);
  }
  if (added.length) {
    void deps.mnemonicGen.ensureMany(added.map((w) => w.id)).catch((err) => console.error("Capture mnemonics failed", err));
    await deps.notifier.dm(user, captureText(added, input.title ?? "", duplicates), { parse_mode: "HTML", reply_markup: captureKeyboard(added) });
    const members = await listMembers(deps.db, roomId);
    for (const word of added) await broadcastWord(deps, word, members, user).catch((err) => console.error("Capture broadcast failed", err));
  }
  return { ok: true, added: added.map((w) => ({ term: w.term, translation: w.translation })), duplicates };
}

/** Слова, которые человек учит в текущей комнате, — расширение подсвечивает их в субтитрах. */
export async function knownWords(deps: Deps, key: string): Promise<CaptureResultWords> {
  const user = await userByCaptureKey(deps, key);
  if (!user) return { ok: false, status: 401, error: "Неверный ключ — возьми новый в боте: /extension" };
  if (user.currentRoomId == null) return { ok: true, words: [] };
  const rows = await deps.db
    .select({ id: words.id, term: words.term, translation: words.translation })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, user.id), eq(words.roomId, user.currentRoomId)));
  return { ok: true, words: rows };
}

export type CaptureResultWords = { ok: true; words: Array<{ id: number; term: string; translation: string }> } | { ok: false; status: number; error: string };

/** Сколько дополнительных реплик хранить у слова. */
export const MORE_CONTEXTS = 3;

/**
 * «📍 Ещё пример»: слово встретилось снова — реплика сохраняется у слова (для всей комнаты).
 * Если у слова ещё не было контекста — становится основным.
 */
export async function addExample(deps: Deps, input: { key: string; wordId: number; context: string; title?: string }): Promise<CaptureResult> {
  const user = await userByCaptureKey(deps, input.key);
  if (!user) return { ok: false, status: 401, error: "Неверный ключ — возьми новый в боте: /extension" };
  const word = await getWord(deps.db, input.wordId);
  if (!word || !(await isMember(deps.db, word.roomId, user.id))) return { ok: false, status: 404, error: "Этого слова уже нет" };
  const context = input.context.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT);
  if (!context) return { ok: false, status: 400, error: "Пустая реплика" };
  const more = JSON.parse(word.moreContexts || "[]") as Array<{ text: string; title: string }>;
  if (word.context === context || more.some((m) => m.text === context)) return { ok: true, added: [], duplicates: [word.term] };
  const patch = word.context
    ? { moreContexts: JSON.stringify([{ text: context, title: input.title ?? "" }, ...more].slice(0, MORE_CONTEXTS)) }
    : { context };
  await deps.db.update(words).set(patch).where(eq(words.id, word.id));
  return { ok: true, added: [{ term: word.term, translation: word.translation }], duplicates: [] };
}

/** Картинка области не больше стольких байт (расширение уменьшает её заранее). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * 🔲 Область экрана без текста на странице (кадр, картинка, скан): Claude читает английский текст,
 * а расширение показывает его в своей панели — слова оттуда добавляются как обычно.
 */
export async function readImage(deps: Deps, input: { key: string; image: string }): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const user = await userByCaptureKey(deps, input.key);
  if (!user) return { ok: false, status: 401, error: "Неверный ключ — возьми новый в боте: /extension" };
  if (!deps.enricher.readImage) return { ok: false, status: 501, error: "Распознавание недоступно" };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(input.image);
  if (!match) return { ok: false, status: 400, error: "Нет картинки" };
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return { ok: false, status: 400, error: "Слишком большая область — выдели поменьше" };
  try {
    const image = { data, mediaType: match[1] as "image/jpeg" | "image/png" | "image/webp" };
    const text = await withLang(await roomLanguage(deps, user.currentRoomId), () => deps.enricher.readImage!(image));
    return { ok: true, text: text.slice(0, 2000) };
  } catch (err) {
    console.error("Read image failed", err);
    return { ok: false, status: 502, error: "Не получилось распознать — попробуй ещё раз" };
  }
}
