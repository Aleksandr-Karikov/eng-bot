import { eq } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs } from "../db/schema";
import { HARD_AFTER_LAPSES } from "./hard-words";

const PRACTICE_SIZE = 20;

/** Карточки для тренировки вне зачёта: уже изученные слова, сначала трудные, потом самые слабые. */
export async function practiceQueue(db: Db, userId: number): Promise<number[]> {
  const own = (await db.select().from(cards).where(eq(cards.userId, userId))).filter((c) => c.state !== State.New);
  const forgot = await db
    .select({ cardId: reviewLogs.cardId })
    .from(reviewLogs)
    .where(eq(reviewLogs.rating, "again"));
  const hard = (id: number) => (forgot.filter((f) => f.cardId === id).length >= HARD_AFTER_LAPSES ? 1 : 0);
  return own
    .sort((a, b) => hard(b.id) - hard(a.id) || a.stability - b.stability || a.id - b.id)
    .slice(0, PRACTICE_SIZE)
    .map((c) => c.id);
}
