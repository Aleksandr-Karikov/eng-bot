import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, clozeSentences, reviewLogs, words, type User, type Word } from "../db/schema";
import { createCards } from "./cards";
import { getRoom, listMembers } from "./rooms";

export interface WordDraft {
  term: string;
  translation: string;
  explanation: string;
  example: string;
  transcriptionUk?: string;
  transcriptionUs?: string;
  mnemonic?: string;
}

/** Только поля слова — без служебных полей черновика/пачки. */
export function toWordDraft(d: WordDraft): WordDraft {
  return {
    term: d.term,
    translation: d.translation,
    explanation: d.explanation,
    example: d.example,
    transcriptionUk: d.transcriptionUk ?? "",
    transcriptionUs: d.transcriptionUs ?? "",
    mnemonic: d.mnemonic ?? "",
  };
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "bank — берег" / "bank - берег" / "bank". Дефис без пробелов вокруг (well-known) — часть слова. */
export function parseAddInput(text: string): { term: string; translation?: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /^[—–-]/.test(trimmed)) return null;
  const m = /^(.+?)\s+[—–-]\s+(.+)$/s.exec(trimmed);
  if (!m) return { term: trimmed };
  return { term: m[1].trim(), translation: m[2].trim() };
}

export async function findWord(db: Db, roomId: number, term: string): Promise<Word | undefined> {
  const [word] = await db
    .select()
    .from(words)
    .where(and(eq(words.roomId, roomId), eq(words.termNormalized, normalizeTerm(term))));
  return word;
}

export async function getWord(db: Db, id: number): Promise<Word | undefined> {
  const [word] = await db.select().from(words).where(eq(words.id, id));
  return word;
}

export async function saveWord(
  db: Db,
  input: { roomId: number; addedBy: number; draft: WordDraft; now: Date },
): Promise<{ status: "duplicate" } | { status: "no-room" } | { status: "saved"; word: Word; members: User[] }> {
  // Черновик мог пережить удаление комнаты.
  if (!(await getRoom(db, input.roomId))) return { status: "no-room" };
  if (await findWord(db, input.roomId, input.draft.term)) return { status: "duplicate" };
  const [word] = await db
    .insert(words)
    .values({
      roomId: input.roomId,
      addedBy: input.addedBy,
      term: input.draft.term.trim(),
      termNormalized: normalizeTerm(input.draft.term),
      translation: input.draft.translation,
      explanation: input.draft.explanation,
      example: input.draft.example,
      transcriptionUk: input.draft.transcriptionUk ?? "",
      transcriptionUs: input.draft.transcriptionUs ?? "",
      mnemonic: input.draft.mnemonic ?? "",
      createdAt: input.now,
    })
    .returning();
  const members = await listMembers(db, input.roomId);
  await createCards(db, members.map((m) => m.id), [word.id], input.now);
  return { status: "saved", word, members };
}

/** Убирает слова, которые уже есть в комнате, и повторы внутри самой пачки (с учётом регистра и пробелов). */
export async function filterNewItems<T extends { term: string }>(db: Db, roomId: number, items: T[]): Promise<T[]> {
  const existing = await db.select({ term: words.termNormalized }).from(words).where(eq(words.roomId, roomId));
  const seen = new Set(existing.map((w) => w.term));
  const fresh: T[] = [];
  for (const item of items) {
    const key = normalizeTerm(item.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...item, term: item.term.trim() });
  }
  return fresh;
}

/** Слова комнаты, новые сверху; fragment — подстрока без учёта регистра и лишних пробелов. */
export async function listRoomWords(db: Db, roomId: number, fragment?: string): Promise<Word[]> {
  const all = await db.select().from(words).where(eq(words.roomId, roomId)).orderBy(desc(words.createdAt), desc(words.id));
  const needle = fragment ? normalizeTerm(fragment) : "";
  return needle ? all.filter((w) => w.termNormalized.includes(needle)) : all;
}

/** Удаляет слово у всех: историю повторений, карточки и само слово. Возвращает удалённое или undefined. */
export async function deleteWord(db: Db, wordId: number): Promise<Word | undefined> {
  const word = await getWord(db, wordId);
  if (!word) return undefined;
  const cardIds = (await db.select({ id: cards.id }).from(cards).where(eq(cards.wordId, wordId))).map((c) => c.id);
  if (cardIds.length) await db.delete(reviewLogs).where(inArray(reviewLogs.cardId, cardIds));
  await db.delete(clozeSentences).where(eq(clozeSentences.wordId, wordId));
  await db.delete(cards).where(eq(cards.wordId, wordId));
  await db.delete(words).where(eq(words.id, wordId));
  return word;
}

/**
 * Исправляет слово, не трогая карточки (прогресс у всех сохраняется).
 * Если term меняется и совпадает с другим словом комнаты — duplicate.
 */
export async function updateWord(
  db: Db,
  wordId: number,
  patch: {
    term?: string;
    translation: string;
    explanation: string;
    example: string;
    /** undefined — оставить как есть. */
    transcriptionUk?: string;
    transcriptionUs?: string;
    /** undefined — оставить, а при смене значения — сбросить. */
    mnemonic?: string;
  },
): Promise<{ status: "duplicate" } | { status: "missing" } | { status: "updated"; word: Word }> {
  const word = await getWord(db, wordId);
  if (!word) return { status: "missing" };
  const term = patch.term?.trim() || word.term;
  const termNormalized = normalizeTerm(term);
  if (termNormalized !== word.termNormalized) {
    const clash = await findWord(db, word.roomId, term);
    if (clash && clash.id !== word.id) return { status: "duplicate" };
  }
  // Предложения с пропуском писались под старое слово/значение — пересоздадутся позже.
  const meaningChanged = termNormalized !== word.termNormalized || patch.translation.trim() !== word.translation.trim();
  if (meaningChanged) await db.delete(clozeSentences).where(eq(clozeSentences.wordId, wordId));
  const [updated] = await db
    .update(words)
    .set({
      term,
      termNormalized,
      translation: patch.translation,
      explanation: patch.explanation,
      example: patch.example,
      transcriptionUk: patch.transcriptionUk ?? word.transcriptionUk,
      transcriptionUs: patch.transcriptionUs ?? word.transcriptionUs,
      // Озвучка относится к самому слову — при его изменении записывается заново.
      ...(termNormalized !== word.termNormalized ? { audioUkFileId: null, audioUsFileId: null } : {}),
      // Запоминалка писалась под старое значение.
      ...(meaningChanged ? { mnemonic: "", imageFileId: null, leechHelp: "" } : {}),
      ...(patch.mnemonic !== undefined ? { mnemonic: patch.mnemonic } : {}),
    })
    .where(eq(words.id, wordId))
    .returning();
  return { status: "updated", word: updated };
}

export async function setAudioFileId(db: Db, wordId: number, accent: "uk" | "us", fileId: string): Promise<void> {
  await db.update(words).set(accent === "uk" ? { audioUkFileId: fileId } : { audioUsFileId: fileId }).where(eq(words.id, wordId));
}

export async function setLeechHelp(db: Db, wordId: number, help: string): Promise<void> {
  await db.update(words).set({ leechHelp: help }).where(eq(words.id, wordId));
}

export async function setMnemonic(db: Db, wordId: number, mnemonic: string): Promise<void> {
  await db.update(words).set({ mnemonic }).where(eq(words.id, wordId));
}

export async function setImageFileId(db: Db, wordId: number, fileId: string): Promise<void> {
  await db.update(words).set({ imageFileId: fileId }).where(eq(words.id, wordId));
}
