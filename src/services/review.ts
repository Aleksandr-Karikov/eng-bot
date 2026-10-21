import { and, asc, count, eq, lte, ne } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, words, type CardRow, type Word } from "../db/schema";
import { review, type Answer } from "../srs/srs";

export interface DueItem {
  card: CardRow;
  word: Word;
}

export const LEARN_AHEAD_MS = 20 * 60_000;

function compareQueue(a: DueItem, b: DueItem): number {
  const aNew = a.card.state === State.New ? 1 : 0;
  const bNew = b.card.state === State.New ? 1 : 0;
  if (aNew !== bNew) return aNew - bNew;
  // Новые — сначала самые полезные: время на зубрёжку тратится на то, что пригодится.
  if (aNew) return (b.word.usefulness ?? 2) - (a.word.usefulness ?? 2) || a.card.createdAt.getTime() - b.card.createdAt.getTime() || a.card.id - b.card.id;
  return a.card.due.getTime() - b.card.due.getTime();
}

async function dueItems(db: Db, userId: number, until: Date): Promise<DueItem[]> {
  const rows = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, userId), lte(cards.due, until)));
  return rows.sort(compareQueue);
}

export async function nextDue(db: Db, userId: number, now: Date): Promise<DueItem | undefined> {
  const [item] = await dueItems(db, userId, now);
  if (item) return item;
  const [ahead] = await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return ahead;
}

/** Очередь /learn целиком (с тем же запасом «на 20 минут вперёд», что у nextDue) — для Mini App, которое грузит карточки заранее. */
export async function dueQueue(db: Db, userId: number, now: Date, limit: number): Promise<DueItem[]> {
  const items = await dueItems(db, userId, now);
  const list = items.length ? items : await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return list.slice(0, limit);
}

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  // Считает каждую минуту для напоминаний — без загрузки самих карточек и слов.
  const [row] = await db.select({ n: count() }).from(cards).where(and(eq(cards.userId, userId), lte(cards.due, now)));
  return row?.n ?? 0;
}

/** К повторению отдельно от новых: пачка слов друга — это знакомство, а не «40 слов ждут повторения». */
export async function countDueSplit(db: Db, userId: number, now: Date): Promise<{ review: number; fresh: number }> {
  const due = and(eq(cards.userId, userId), lte(cards.due, now));
  const [review] = await db.select({ n: count() }).from(cards).where(and(due, ne(cards.state, State.New)));
  const [fresh] = await db.select({ n: count() }).from(cards).where(and(due, eq(cards.state, State.New)));
  return { review: review?.n ?? 0, fresh: fresh?.n ?? 0 };
}

export async function getDueItemByCard(db: Db, userId: number, cardId: number): Promise<DueItem | undefined> {
  const [row] = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return row;
}

async function usefulnessOf(db: Db, wordId: number): Promise<number | null> {
  const [word] = await db.select({ usefulness: words.usefulness }).from(words).where(eq(words.id, wordId));
  return word?.usefulness ?? null;
}

async function applyAnswer(db: Db, card: CardRow, answer: Answer, now: Date, stage?: string): Promise<void> {
  await db.update(cards).set(review(card.fsrs, answer, now, await usefulnessOf(db, card.wordId))).where(eq(cards.id, card.id));
  await db.insert(reviewLogs).values({ userId: card.userId, cardId: card.id, rating: answer, stage: stage ?? null, reviewedAt: now });
}

export async function answerCard(
  db: Db,
  input: { userId: number; cardId: number; expectedReps: number; answer: Answer; now: Date; stage?: string },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)));
  if (!card || card.reps !== input.expectedReps) return "stale";
  // Условное обновление «если reps всё ещё прежний»: два почти одновременных ответа (кнопка и текст)
  // не засчитаются дважды — второй увидит, что карточку уже обновили.
  const [updated] = await db
    .update(cards)
    .set(review(card.fsrs, input.answer, input.now, await usefulnessOf(db, card.wordId)))
    .where(and(eq(cards.id, card.id), eq(cards.reps, input.expectedReps)))
    .returning({ id: cards.id });
  if (!updated) return "stale";
  await db.insert(reviewLogs).values({ userId: card.userId, cardId: card.id, rating: input.answer, stage: input.stage ?? null, reviewedAt: input.now });
  return "ok";
}

export async function markKnown(
  db: Db,
  input: { userId: number; wordId: number; now: Date },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.wordId, input.wordId), eq(cards.userId, input.userId)));
  if (!card || card.state !== State.New || card.reps !== 0) return "stale";
  await applyAnswer(db, card, "easy", input.now, "know");
  return "ok";
}

export async function nextReviewAt(db: Db, userId: number): Promise<Date | undefined> {
  const [row] = await db
    .select({ due: cards.due })
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(asc(cards.due))
    .limit(1);
  return row?.due;
}
