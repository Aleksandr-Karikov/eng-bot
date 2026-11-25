import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { clozeSentences, type ClozeSentence } from "../db/schema";

export interface ClozeDraft {
  sentence: string;
  answer: string;
  translation: string;
}

/** Пропуск: три и больше подчёркиваний подряд. Модель пишет и `___`, и `_______`. */
const GAP = /_{3,}/g;

/** Сколько пропусков в предложении. */
export const gapCount = (sentence: string): number => (sentence.match(GAP) ?? []).length;

/**
 * Части предложения между пропусками: `a ___ b ___ c` → `["a ", " b ", " c"]`.
 *
 * Частей всегда на одну больше, чем пропусков. На этом держится и показ (что стоит до/после
 * каждого пропуска), и поля ввода в приложении — по одному на пропуск (баг #25).
 */
export function gapSegments(sentence: string): string[] {
  return sentence.split(GAP);
}

/**
 * Ответы по пропускам. В базе они хранятся одной строкой через `|`: `do me|favor`.
 *
 * Разделитель, а не пробел: `do me a favor` состоит из четырёх слов, и угадать, где кончается
 * первый пропуск, а где начинается второй, по словам нельзя. Один пропуск пишется как раньше,
 * без разделителя, — старые записи читаются без миграции.
 */
export const ANSWERS_SEP = "|";

export function answersOf(answer: string): string[] {
  return answer.includes(ANSWERS_SEP)
    ? answer.split(ANSWERS_SEP).map((a) => a.trim()).filter(Boolean)
    : [answer.trim()];
}

/** Обратная операция: из ответов по пропускам — строка для базы. */
export const joinAnswers = (answers: string[]): string => answers.map((a) => a.trim()).filter(Boolean).join(ANSWERS_SEP);

/**
 * Совпадает ли число ответов с числом пропусков.
 *
 * Задание с двумя пропусками и одним ответом нерешаемо: человек вписывает одно слово, а заполнить
 * надо два (баг #25 — «ответ не заполняет оба пропуска»). Такие предложения отбрасываем: лучше
 * показать два нормальных задания, чем одно нерешаемое.
 */
export function clozeMatches(sentence: string, answer: string): boolean {
  const gaps = gapCount(sentence);
  return gaps > 0 && gaps === answersOf(answer).length;
}

export async function listCloze(db: Db, wordId: number): Promise<ClozeSentence[]> {
  return db.select().from(clozeSentences).where(eq(clozeSentences.wordId, wordId)).orderBy(asc(clozeSentences.id));
}

export async function saveCloze(db: Db, wordId: number, items: ClozeDraft[], now: Date): Promise<void> {
  // Проверка и здесь, а не только в разборе ответа модели: saveCloze зовут и скрипты.
  const usable = items.filter((i) => clozeMatches(i.sentence, i.answer));
  if (usable.length === 0) return;
  await db.insert(clozeSentences).values(usable.map((i) => ({ ...i, wordId, createdAt: now })));
}

/** Предложения показываются по очереди, чтобы не заучивать одно вместо слова. */
export function pickCloze(sentences: ClozeSentence[], reps: number): ClozeSentence | undefined {
  return sentences.length ? sentences[reps % sentences.length] : undefined;
}
