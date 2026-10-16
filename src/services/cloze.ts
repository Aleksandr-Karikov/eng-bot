import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { clozeSentences, type ClozeSentence } from "../db/schema";

export interface ClozeDraft {
  sentence: string;
  answer: string;
  translation: string;
}

export async function listCloze(db: Db, wordId: number): Promise<ClozeSentence[]> {
  return db.select().from(clozeSentences).where(eq(clozeSentences.wordId, wordId)).orderBy(asc(clozeSentences.id));
}

export async function saveCloze(db: Db, wordId: number, items: ClozeDraft[], now: Date): Promise<void> {
  if (items.length === 0) return;
  await db.insert(clozeSentences).values(items.map((i) => ({ ...i, wordId, createdAt: now })));
}

/** Предложения показываются по очереди, чтобы не заучивать одно вместо слова. */
export function pickCloze(sentences: ClozeSentence[], reps: number): ClozeSentence | undefined {
  return sentences.length ? sentences[reps % sentences.length] : undefined;
}
