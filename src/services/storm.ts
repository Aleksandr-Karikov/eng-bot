import { asc, eq, inArray } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, stormStarts, words } from "../db/schema";
import { inCurrentLanguage } from "./language";
import { HARD_AFTER_LAPSES } from "./hard-words";

export const STORM_SIZE = 5;
export const STORM_MIN = 3;

export function isStormHard(ratings: string[]): boolean {
  return ratings.filter((rating) => rating === "again").length >= HARD_AFTER_LAPSES &&
    !(ratings.length >= 2 && ratings.slice(-2).every((rating) => rating === "good" || rating === "easy"));
}

/** Кандидат появляется после 4 провалов; после штурма нужен новый обычный провал. */
export async function stormCandidates(db: Db, userId: number): Promise<Array<{ cardId: number; triggerLogId: number }>> {
  const own = (await inCurrentLanguage(db, await db.select({ card: cards, word: words }).from(cards)
    .innerJoin(words, eq(cards.wordId, words.id)).where(eq(cards.userId, userId))))
    .filter(({ card, word }) => card.state !== State.New && word.usefulness !== 1);
  const logs = await db.select({ id: reviewLogs.id, cardId: reviewLogs.cardId, rating: reviewLogs.rating })
    .from(reviewLogs).where(eq(reviewLogs.userId, userId)).orderBy(asc(reviewLogs.id));
  const starts = new Map((own.length ? await db.select().from(stormStarts).where(inArray(stormStarts.cardId, own.map(({ card }) => card.id))) : [])
    .map((r) => [r.cardId, r.triggerLogId]));
  const byCard = new Map<number, typeof logs>();
  for (const log of logs) {
    const history = byCard.get(log.cardId) ?? [];
    history.push(log);
    byCard.set(log.cardId, history);
  }
  return own.flatMap(({ card }) => {
    const history = byCard.get(card.id) ?? [];
    const failures = history.filter((l) => l.rating === "again");
    const last = failures.at(-1);
    if (!isStormHard(history.map((l) => l.rating)) || !last || last.id <= (starts.get(card.id) ?? 0)) return [];
    return [{ cardId: card.id, triggerLogId: last.id, failures: failures.length }];
  }).sort((a, b) => b.failures - a.failures || b.triggerLogId - a.triggerLogId)
    .slice(0, STORM_SIZE).map(({ cardId, triggerLogId }) => ({ cardId, triggerLogId }));
}

export async function markStormStarted(db: Db, candidates: Array<{ cardId: number; triggerLogId: number }>): Promise<void> {
  for (const { cardId, triggerLogId } of candidates) {
    const [existing] = await db.select({ cardId: stormStarts.cardId }).from(stormStarts).where(eq(stormStarts.cardId, cardId));
    if (existing) await db.update(stormStarts).set({ triggerLogId }).where(eq(stormStarts.cardId, cardId));
    else await db.insert(stormStarts).values({ cardId, triggerLogId });
  }
}
