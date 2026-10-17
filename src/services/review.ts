import { and, asc, eq, lte } from "drizzle-orm";
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
  if (aNew) return a.card.createdAt.getTime() - b.card.createdAt.getTime() || a.card.id - b.card.id;
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

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  return (await dueItems(db, userId, now)).length;
}

export async function getDueItemByCard(db: Db, userId: number, cardId: number): Promise<DueItem | undefined> {
  const [row] = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return row;
}

async function applyAnswer(db: Db, card: CardRow, answer: Answer, now: Date, stage?: string): Promise<void> {
  await db.update(cards).set(review(card.fsrs, answer, now)).where(eq(cards.id, card.id));
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
  await applyAnswer(db, card, input.answer, input.now, input.stage);
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
