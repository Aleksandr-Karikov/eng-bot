import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words, type User, type Word } from "../db/schema";
import { createCards } from "./cards";
import { listMembers } from "./rooms";

export interface WordDraft {
  term: string;
  translation: string;
  explanation: string;
  example: string;
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
): Promise<{ status: "duplicate" } | { status: "saved"; word: Word; members: User[] }> {
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
      createdAt: input.now,
    })
    .returning();
  const members = await listMembers(db, input.roomId);
  await createCards(db, members.map((m) => m.id), [word.id], input.now);
  return { status: "saved", word, members };
}
