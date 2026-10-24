import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, users, words, type CardRow, type Word } from "../db/schema";
import { dropCard, restoreCard } from "./cards";
import { markKnown, undoAnswer } from "./review";

/**
 * Колода «новые слова от друзей»: решить про каждое одним свайпом — учу, уже знаю или не для меня.
 * Свои слова сюда не попадают (их добавил сам — значит, учишь), как и уже разобранные или начатые.
 */
export type TriageAction = "learn" | "know" | "drop";

export interface TriageItem {
  card: CardRow;
  word: Word;
  addedBy: string;
}

export async function triageQueue(db: Db, userId: number, limit = 50): Promise<TriageItem[]> {
  const rows = await db
    .select({ card: cards, word: words, addedBy: users.firstName })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(words.addedBy, users.id))
    .where(and(eq(cards.userId, userId), eq(cards.state, State.New), eq(cards.reps, 0), isNull(cards.triagedAt), ne(words.addedBy, userId)))
    .orderBy(asc(words.createdAt), asc(words.id))
    .limit(limit);
  return rows;
}

export async function triageCount(db: Db, userId: number): Promise<number> {
  return (await triageQueue(db, userId, 1000)).length;
}

/** Отметить слово разобранным (например, «📚 Не знаю» в «знаешь?»): в колоду оно больше не попадёт. */
export async function markTriaged(db: Db, userId: number, wordId: number, now: Date): Promise<void> {
  await db.update(cards).set({ triagedAt: now }).where(and(eq(cards.userId, userId), eq(cards.wordId, wordId)));
}

/** Решение по карточке из колоды. false — карточки уже нет или по ней уже решили. */
export async function triage(db: Db, input: { userId: number; cardId: number; action: TriageAction; now: Date }): Promise<boolean> {
  const [card] = await db.select().from(cards).where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)));
  if (!card || card.triagedAt) return false;
  if (input.action === "drop") return dropCard(db, input.userId, card.wordId);
  if (input.action === "know" && (await markKnown(db, { userId: input.userId, wordId: card.wordId, now: input.now })) === "stale") return false;
  await db.update(cards).set({ triagedAt: input.now }).where(eq(cards.id, card.id));
  return true;
}

/** ↩️ Отменить решение: слово снова новое и неразобранное. wordId нужен для «не для меня» — карточки тогда уже нет. */
export async function undoTriage(db: Db, input: { userId: number; cardId: number; wordId: number; action: TriageAction; now: Date }): Promise<boolean> {
  if (input.action === "drop") {
    await restoreCard(db, input.userId, input.wordId, input.now);
    return true;
  }
  if (input.action === "know" && !(await undoAnswer(db, { userId: input.userId, cardId: input.cardId }))) return false;
  const [updated] = await db
    .update(cards)
    .set({ triagedAt: null })
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)))
    .returning({ id: cards.id });
  return Boolean(updated);
}
