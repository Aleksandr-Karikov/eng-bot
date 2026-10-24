import { RetryLater } from "./retry-later";
import type { Db } from "../db/client";
import type { ExerciseTutor } from "../llm/tutor";
import { withLang } from "../lang";
import { listCloze, saveCloze } from "./cloze";
import { wordLanguage } from "./words";

/** Готовит предложения с пропуском для слова в фоне — один запрос на слово, даже если попросили несколько раз. */
export class ClozeGenerator {
  private readonly inFlight = new Map<number, Promise<void>>();
  private readonly retry = new RetryLater();

  constructor(
    private readonly db: Db,
    private readonly tutor: ExerciseTutor,
    private readonly now: () => Date,
  ) {}

  ensure(word: { id: number; term: string; translation: string }): Promise<void> {
    const running = this.inFlight.get(word.id);
    if (running) return running;
    if (this.retry.blocked(word.id)) return Promise.resolve();
    const task = this.generate(word)
      .catch((err) => {
        this.retry.failed(word.id);
        console.error("Cloze generation failed", word.term, err);
      })
      .finally(() => this.inFlight.delete(word.id));
    this.inFlight.set(word.id, task);
    return task;
  }

  private async generate(word: { id: number; term: string; translation: string }): Promise<void> {
    if ((await listCloze(this.db, word.id)).length > 0) return;
    const lang = await wordLanguage(this.db, word.id);
    const items = await withLang(lang, () => this.tutor.cloze(word.term, word.translation));
    if ((await listCloze(this.db, word.id)).length > 0) return;
    await saveCloze(this.db, word.id, items, this.now());
  }
}
