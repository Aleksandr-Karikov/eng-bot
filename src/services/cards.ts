import { and, eq, notExists } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs } from "../db/schema";
import { newCard } from "../srs/srs";
import { removeReviewHistory } from "./combat-ledger";

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
  await removeReviewHistory(db, eq(reviewLogs.cardId, card.id));
  await db.delete(cards).where(eq(cards.id, card.id));
  return true;
}

/** Отказ при первом показе не должен удалить начатую карточку из другой сессии. */
export async function dropNewCard(db: Db, userId: number, cardId: number): Promise<boolean> {
  const [dropped] = await db.delete(cards).where(and(
    eq(cards.id, cardId),
    eq(cards.userId, userId),
    eq(cards.state, State.New),
    eq(cards.reps, 0),
    notExists(db.select({ id: reviewLogs.id }).from(reviewLogs).where(eq(reviewLogs.cardId, cards.id))),
  )).returning({ id: cards.id });
  return Boolean(dropped);
}

/** В чате уже выбрали изучать слово, Mini App может сразу показать обычную карточку. */
export async function markTriaged(db: Db, userId: number, wordId: number, now: Date): Promise<void> {
  await db.update(cards).set({ triagedAt: now }).where(and(eq(cards.userId, userId), eq(cards.wordId, wordId)));
}

/** «↩️ Вернуть»: слово снова в изучении — как новое. */
export async function restoreCard(db: Db, userId: number, wordId: number, now: Date): Promise<void> {
  await createCards(db, [userId], [wordId], now);
}
