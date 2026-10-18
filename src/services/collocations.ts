import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words } from "../db/schema";
import type { Collocations, ExerciseTutor } from "../llm/tutor";
import { getWord } from "./words";

/** Сохранённые сочетания слова; undefined — ещё не готовили. */
export function storedCollocations(word: { collocations: string }): Collocations | undefined {
  return word.collocations ? (JSON.parse(word.collocations) as Collocations) : undefined;
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
    const result = await this.tutor.collocations(word.term, word.translation);
    const fresh = await getWord(this.db, word.id);
    // Пока Claude думал, слово могли изменить — тогда сочетания уже не к нему.
    if (!fresh || fresh.collocations || fresh.term !== word.term || fresh.translation !== word.translation) return;
    await this.db.update(words).set({ collocations: JSON.stringify(result) }).where(eq(words.id, word.id));
  }
}
