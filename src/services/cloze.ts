import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { clozeSentences, type ClozeSentence } from "../db/schema";

export interface ClozeDraft {
  sentence: string;
  answer: string;
  translation: string;
}

/** Длина пропуска: три и больше подчёркиваний подряд. */
const GAP = /_{3,}/g;

/** Все пропуски в предложении — от левого к правому. */
export const gapsIn = (sentence: string): string[] => sentence.match(GAP) ?? [];

/**
 * Годится ли предложение с пропуском. Ровно один пропуск — на нём держится весь разбор: `gapParts`
 * подставляет ответ в единственный пропуск, а второй остаётся в тексте пустым (баг #25): у человека
 * выходило «The past seems to **have hold** a strong ____ on him». Модель иногда ставит два пропуска
 * на фразу из двух слов — такой вопрос отбрасываем, а не пытаемся угадать, что куда вставлять.
 */
export function validCloze(sentence: string): boolean {
  return gapsIn(sentence).length === 1;
}

export async function listCloze(db: Db, wordId: number): Promise<ClozeSentence[]> {
  return db.select().from(clozeSentences).where(eq(clozeSentences.wordId, wordId)).orderBy(asc(clozeSentences.id));
}

export async function saveCloze(db: Db, wordId: number, items: ClozeDraft[], now: Date): Promise<void> {
  // Проверка и здесь, а не только в разборе ответа модели: saveCloze зовут и скрипты, а предложение
  // с двумя пропусками ломает разбор уже после сохранения.
  const usable = items.filter((i) => validCloze(i.sentence));
  if (usable.length === 0) return;
  await db.insert(clozeSentences).values(usable.map((i) => ({ ...i, wordId, createdAt: now })));
}

/** Предложения показываются по очереди, чтобы не заучивать одно вместо слова. */
export function pickCloze(sentences: ClozeSentence[], reps: number): ClozeSentence | undefined {
  return sentences.length ? sentences[reps % sentences.length] : undefined;
}
