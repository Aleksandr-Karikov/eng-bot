import { and, eq, gte } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, words, type User } from "../db/schema";
import { localParts, previousDate } from "../time";
import { listMembers } from "./rooms";

export const LEARNED_STABILITY_DAYS = 21;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export function isLearned(card: { state: number; stability: number }): boolean {
  return card.state === State.Review && card.stability >= LEARNED_STABILITY_DAYS;
}

export function computeStreak(dates: Set<string>, today: string): number {
  let day = dates.has(today) ? today : previousDate(today);
  let streak = 0;
  while (dates.has(day)) {
    streak++;
    day = previousDate(day);
  }
  return streak;
}

export interface PersonalStats {
  total: number;
  learned: number;
  learning: number;
  fresh: number;
  reviews7d: number;
  streak: number;
}

export async function personalStats(db: Db, user: User, now: Date): Promise<PersonalStats> {
  const userCards = await db
    .select({ state: cards.state, stability: cards.stability })
    .from(cards)
    .where(eq(cards.userId, user.id));
  const logs = await db
    .select({ reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, user.id));

  const learned = userCards.filter(isLearned).length;
  const fresh = userCards.filter((c) => c.state === State.New).length;
  const weekAgo = now.getTime() - WEEK_MS;
  const dates = new Set(logs.map((l) => localParts(user.timezone, l.reviewedAt).date));

  return {
    total: userCards.length,
    learned,
    learning: userCards.length - learned - fresh,
    fresh,
    reviews7d: logs.filter((l) => l.reviewedAt.getTime() >= weekAgo).length,
    streak: computeStreak(dates, localParts(user.timezone, now).date),
  };
}

export interface LeaderRow {
  userId: number;
  name: string;
  learned: number;
  reviews7d: number;
}

export async function roomLeaderboard(db: Db, roomId: number, now: Date): Promise<LeaderRow[]> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const members = await listMembers(db, roomId);
  const rows: LeaderRow[] = [];
  for (const member of members) {
    const memberCards = await db
      .select({ state: cards.state, stability: cards.stability })
      .from(cards)
      .innerJoin(words, eq(cards.wordId, words.id))
      .where(and(eq(cards.userId, member.id), eq(words.roomId, roomId)));
    const recent = await db
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
      .innerJoin(words, eq(cards.wordId, words.id))
      .where(and(eq(reviewLogs.userId, member.id), eq(words.roomId, roomId), gte(reviewLogs.reviewedAt, weekAgo)));
    rows.push({ userId: member.id, name: member.firstName, learned: memberCards.filter(isLearned).length, reviews7d: recent.length });
  }
  return rows.sort((a, b) => b.reviews7d - a.reviews7d || b.learned - a.learned);
}
