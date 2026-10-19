import { rateUsefulness } from "../services/usefulness";
import { and, eq } from "drizzle-orm";
import type { Deps } from "../bot/context";
import { captureKeyboard } from "../bot/keyboards";
import { captureText } from "../bot/texts";
import { broadcastBatch } from "../bot/word-flow";
import { cards, users, words, type User, type Word } from "../db/schema";
import { findWord, getWord, MAX_CONTEXT, saveWord } from "../services/words";
import { isMember } from "../services/rooms";

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
/** Друзьям — одной сводкой, когда человек перестал добавлять (досмотрел серию), а не по сообщению на слово. */
const BROADCAST_QUIET_MS = 10 * 60_000;

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

/** Копит добавленные слова и рассказывает о них комнате одной сводкой после паузы. */
export class CaptureBroadcaster {
  private readonly pending = new Map<number, { roomId: number; adder: User; words: Word[]; timer: NodeJS.Timeout }>();

  constructor(
    private readonly deps: Deps,
    private readonly quietMs = BROADCAST_QUIET_MS,
  ) {}

  add(adder: User, roomId: number, words: Word[]): void {
    const entry = this.pending.get(adder.id);
    if (entry) clearTimeout(entry.timer);
    const next = { roomId, adder, words: [...(entry?.roomId === roomId ? entry.words : []), ...words], timer: undefined as unknown as NodeJS.Timeout };
    next.timer = setTimeout(() => void this.flush(adder.id), this.quietMs);
    this.pending.set(adder.id, next);
  }

  /** Слово отменили — в сводку оно не попадёт. */
  forget(adderId: number, wordId: number): void {
    const entry = this.pending.get(adderId);
    if (entry) entry.words = entry.words.filter((w) => w.id !== wordId);
  }

  /** При остановке бота — разослать накопленные сводки сразу, иначе они пропадут вместе с таймерами. */
  async flushAll(): Promise<void> {
    for (const adderId of [...this.pending.keys()]) await this.flush(adderId);
  }

  async flush(adderId: number): Promise<void> {
    const entry = this.pending.get(adderId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(adderId);
    await broadcastBatch(this.deps, entry.roomId, entry.words, entry.adder).catch((err) => console.error("Capture broadcast failed", err));
  }
}

/**
 * Добавляет слово из расширения сразу, без черновика: перевод — в значении из реплики, реплика — контекст (📍).
 * Автору — сообщение с «↩️ Отменить», друзьям — сводка позже.
 */
export async function capture(deps: Deps, broadcaster: CaptureBroadcaster, input: CaptureInput): Promise<CaptureResult> {
  const user = await userByCaptureKey(deps, input.key);
  if (!user) return { ok: false, status: 401, error: "Неверный ключ — возьми новый в боте: /extension" };
  if (user.currentRoomId == null) return { ok: false, status: 400, error: "Сначала выбери комнату в боте: /room" };
  const roomId = user.currentRoomId;
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
  for (const draft of drafts) {
    if (await findWord(deps.db, roomId, draft.term)) {
      duplicates.push(draft.term);
      continue;
    }
    const result = await saveWord(deps.db, { roomId, addedBy: user.id, draft: { ...draft, mnemonic: "", context }, now: deps.now() });
    if (result.status === "saved") added.push(result.word);
  }
  if (added.length) {
    void deps.mnemonicGen.ensureMany(added.map((w) => w.id)).catch((err) => console.error("Capture mnemonics failed", err));
    await deps.notifier.dm(user, captureText(added, input.title ?? "", duplicates), { parse_mode: "HTML", reply_markup: captureKeyboard(added) });
    broadcaster.add(user, roomId, added);
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
