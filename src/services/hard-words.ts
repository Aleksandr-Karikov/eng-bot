import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs } from "../db/schema";
import type { ExerciseTutor } from "../llm/tutor";
import { getWord, setMnemonic } from "./words";

/** После стольких «Забыл» слово считается трудным для этого пользователя — ему показываем запоминалку. */
export const HARD_AFTER_LAPSES = 4;
const MANY_CHUNK = 20;

export async function forgotCount(db: Db, cardId: number): Promise<number> {
  const rows = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.cardId, cardId), eq(reviewLogs.rating, "again")));
  return rows.length;
}

export async function isHard(db: Db, cardId: number): Promise<boolean> {
  return (await forgotCount(db, cardId)) >= HARD_AFTER_LAPSES;
}

/** Готовит запоминалку для слова в фоне — один запрос к Claude на слово, даже если попросили несколько раз. */
export class MnemonicGenerator {
  private readonly inFlight = new Map<number, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly tutor: ExerciseTutor,
  ) {}

  ensure(wordId: number): Promise<void> {
    const running = this.inFlight.get(wordId);
    if (running) return running;
    const task = this.generate(wordId)
      .catch((err) => console.error("Mnemonic generation failed", wordId, err))
      .finally(() => this.inFlight.delete(wordId));
    this.inFlight.set(wordId, task);
    return task;
  }

  /** Пачкой (по 20 на запрос) для слов, у которых запоминалки ещё нет, — например, после /text. */
  async ensureMany(wordIds: number[]): Promise<void> {
    const words = [];
    for (const id of wordIds) {
      const w = await getWord(this.db, id);
      if (w && !w.mnemonic) words.push(w);
    }
    for (let i = 0; i < words.length; i += MANY_CHUNK) {
      const chunk = words.slice(i, i + MANY_CHUNK);
      const finals = await this.tutor.mnemonics(chunk.map((w) => ({ term: w.term, translation: w.translation })));
      for (const [k, w] of chunk.entries()) {
        const fresh = await getWord(this.db, w.id);
        if (finals[k] && fresh && !fresh.mnemonic && fresh.term === w.term && fresh.translation === w.translation) {
          await setMnemonic(this.db, w.id, finals[k]);
        }
      }
    }
  }

  private async generate(wordId: number): Promise<void> {
    const word = await getWord(this.db, wordId);
    if (!word || word.mnemonic) return;
    const [mnemonic] = await this.tutor.mnemonics([{ term: word.term, translation: word.translation }]);
    if (!mnemonic) return;
    const fresh = await getWord(this.db, wordId);
    // Пока Claude думал, слово могли удалить или изменить — тогда запоминалка уже не к месту.
    if (fresh && !fresh.mnemonic && fresh.term === word.term && fresh.translation === word.translation) {
      await setMnemonic(this.db, wordId, mnemonic);
    }
  }
}
