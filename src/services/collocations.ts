import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words } from "../db/schema";
import type { Collocations, ExerciseTutor } from "../llm/tutor";
import { getWord } from "./words";

const tokens = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").split(/[^\p{L}']+/u).filter(Boolean);

/**
 * Вопрос на сочетания годится, только если ответ — «партнёр» слова, а не оно само или его часть:
 * для draw up вариант draw подсказан заголовком «Какое слово подходит к draw up?».
 */
export function validQuiz(quiz: NonNullable<Collocations["quiz"]>, term: string): boolean {
  const termWords = new Set(tokens(term));
  const answer = tokens(quiz.options[quiz.correct] ?? "");
  return answer.length > 0 && !answer.some((w) => termWords.has(w));
}

/** Сохранённые сочетания слова; undefined — ещё не готовили. Негодный вопрос отбрасывается (в том числе у старых слов). */
export function storedCollocations(word: { collocations: string; term: string }): Collocations | undefined {
  if (!word.collocations) return undefined;
  const c = JSON.parse(word.collocations) as Collocations;
  return c.quiz && !validQuiz(c.quiz, word.term) ? { items: c.items } : c;
}

/** Готовит сочетания для слова в фоне — один запрос на слово, даже если попросили несколько раз. */
export class CollocationGenerator {
  private readonly inFlight = new Map<number, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly tutor: ExerciseTutor,
  ) {}

  ensure(word: { id: number; term: string; translation: string; collocations: string }): Promise<void> {
    if (word.collocations) return Promise.resolve();
    const running = this.inFlight.get(word.id);
    if (running) return running;
    const task = this.generate(word)
      .catch((err) => console.error("Collocations failed", word.term, err))
      .finally(() => this.inFlight.delete(word.id));
    this.inFlight.set(word.id, task);
    return task;
  }

  private async generate(word: { id: number; term: string; translation: string }): Promise<void> {
    const generated = await this.tutor.collocations(word.term, word.translation);
    const result = generated.quiz && !validQuiz(generated.quiz, word.term) ? { items: generated.items } : generated;
    const fresh = await getWord(this.db, word.id);
    // Пока Claude думал, слово могли изменить — тогда сочетания уже не к нему.
    if (!fresh || fresh.collocations || fresh.term !== word.term || fresh.translation !== word.translation) return;
    await this.db.update(words).set({ collocations: JSON.stringify(result) }).where(eq(words.id, word.id));
  }
}
