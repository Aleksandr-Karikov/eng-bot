import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs } from "../db/schema";
import { newCard } from "../srs/srs";

const CHUNK = 200;

export async function createCards(db: Db, userIds: number[], wordIds: number[], now: Date): Promise<void> {
  const rows = userIds.flatMap((userId) => wordIds.map((wordId) => ({ userId, wordId, createdAt: now, ...newCard(now) })));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(cards).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

/**
 * «🙈 Не для меня»: убирает слово только у этого человека — его карточку и историю ответов.
 * У остальных участников слово остаётся. false — карточки и так не было.
 */
export async function dropCard(db: Db, userId: number, wordId: number): Promise<boolean> {
  const [card] = await db.select({ id: cards.id }).from(cards).where(and(eq(cards.userId, userId), eq(cards.wordId, wordId)));
  if (!card) return false;
  await db.delete(reviewLogs).where(eq(reviewLogs.cardId, card.id));
  await db.delete(cards).where(eq(cards.id, card.id));
  return true;
}

/** «↩️ Вернуть»: слово снова в изучении — как новое. */
export async function restoreCard(db: Db, userId: number, wordId: number, now: Date): Promise<void> {
  await createCards(db, [userId], [wordId], now);
}
