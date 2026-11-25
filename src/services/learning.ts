import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNotNull, ne, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, users } from "../db/schema";
import { withCombatLock } from "./combat-ledger";
import { KNOW_STAGE } from "./goals";
import { LEARNED_STABILITY_DAYS } from "./stats";

function knownCard(db: Db) {
  return or(
    and(eq(cards.state, State.Review), gte(cards.stability, LEARNED_STABILITY_DAYS)),
    and(eq(cards.reps, 1), exists(db.select({ id: reviewLogs.id }).from(reviewLogs)
      .where(and(eq(reviewLogs.cardId, cards.id), eq(reviewLogs.stage, KNOW_STAGE))))),
  )!;
}

export async function learningSelection(db: Db, userId: number) {
  const [user] = await db.select({ limit: users.activeLearningLimit }).from(users).where(eq(users.id, userId));
  const limit = user?.limit ?? 0;
  const candidates = await db
    .select({ id: cards.id, wordId: cards.wordId, priority: cards.learningPriority, state: cards.state, relearningAtLimit: cards.relearningAtLimit })
    .from(cards)
    .where(and(eq(cards.userId, userId), or(
      and(eq(cards.state, State.New), or(gt(cards.learningPriority, 0), isNotNull(cards.relearningAtLimit))),
      and(ne(cards.state, State.New), not(knownCard(db))),
    )))
    .orderBy(desc(cards.learningPriority), asc(cards.id));
  // При явном снижении предела забытые слова остаются в подборке и занимают места по новому пределу.
  const retained = candidates.filter((card) => (card.relearningAtLimit ?? 0) > limit);
  const ranked = candidates.filter((card) => (card.relearningAtLimit ?? 0) <= limit);
  const lastReturn = ranked.map(({ relearningAtLimit }) => relearningAtLimit !== null).lastIndexOf(true);
  const size = Math.max(limit - retained.length, lastReturn + 1);
  return { limit, active: [...ranked.slice(0, size), ...retained], waiting: ranked.slice(size) };
}

export function reviewableCards(db: Db, activeIds: number[]) {
  return and(ne(cards.state, State.New), or(inArray(cards.id, activeIds), knownCard(db)));
}

export function takeLearningWord(db: Db, userId: number, wordId: number, replaceWordId?: number) {
  return withCombatLock(db, async () => {
    const [target] = await db.select({ id: cards.id, state: cards.state }).from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.wordId, wordId)));
    if (!target) return false;

    const { limit, active, waiting } = await learningSelection(db, userId);
    if (active.some((card) => card.id === target.id)) return true;
    if (target.state !== State.New && !waiting.some((card) => card.id === target.id)) return false;

    const outgoing = active.find((card) => card.wordId === replaceWordId);
    if (replaceWordId === undefined ? active.length >= limit : !outgoing) return false;

    const relearningAtLimit = outgoing?.relearningAtLimit ?? null;
    const priority = relearningAtLimit !== null && outgoing
      ? outgoing.priority
      : Math.max(0, waiting[0]?.priority ?? 0, ...active.map((card) => card.priority)) + 1;
    const deferred = Math.min(0, waiting.at(-1)?.priority ?? 0, ...active.map((card) => card.priority)) - 1;
    const ids = outgoing ? [target.id, outgoing.id] : [target.id];
    const own = alias(cards, "swapped_cards");
    const existing = db.select({ n: count() }).from(own).where(and(eq(own.userId, userId), inArray(own.id, ids)));
    const changed = await db.update(cards).set({
      learningPriority: outgoing
        ? sql`case when ${cards.id} = ${target.id} then ${priority} else ${deferred} end`
        : priority,
      relearningAtLimit: relearningAtLimit === null ? null : sql`case when ${cards.id} = ${target.id} then ${relearningAtLimit} end`,
    }).where(and(eq(cards.userId, userId), inArray(cards.id, ids), sql`(${existing}) = ${ids.length}`)).returning({ id: cards.id });
    return changed.length === ids.length;
  });
}
