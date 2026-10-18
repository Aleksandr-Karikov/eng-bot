import { and, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, rooms, users, words, type Room } from "../db/schema";
import { latestDigestMoment, WEEK_MS } from "./digest";

/** Автоцель не меньше этого — иначе после пустой недели цель стала бы нулевой. */
const MIN_AUTO_GOAL = 50;
/** Автоцель — на 10% больше прошлой недели, округлённо до десятков. */
const AUTO_GROWTH = 1.1;

export interface GoalProgress {
  target: number;
  done: number;
  /** Цель задана сама, по прошлой неделе. */
  auto: boolean;
  /** Вклад участников, больше — выше. */
  byUser: Array<{ name: string; count: number }>;
}

/** Ответы на карточки слов комнаты в [from, to), по участникам. */
async function roomReviews(db: Db, roomId: number, from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ name: users.firstName })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, roomId), gte(reviewLogs.reviewedAt, from), lt(reviewLogs.reviewedAt, to)));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return counts;
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function autoGoal(lastWeek: number): number {
  return Math.max(MIN_AUTO_GOAL, Math.ceil(Math.round(lastWeek * AUTO_GROWTH) / 10) * 10);
}

/** Прогресс недели, которая начинается в weekStart (по умолчанию — текущей). */
export async function goalProgress(db: Db, room: Room, now: Date, weekStart = latestDigestMoment(now).at): Promise<GoalProgress> {
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const counts = await roomReviews(db, room.id, weekStart, weekEnd);
  const target = room.weeklyGoal > 0 ? room.weeklyGoal : autoGoal(total(await roomReviews(db, room.id, new Date(weekStart.getTime() - WEEK_MS), weekStart)));
  const byUser = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { target, done: total(counts), auto: room.weeklyGoal <= 0, byUser };
}

/** Прогресс недели, которая только что закончилась (для воскресного дайджеста). */
export function lastWeekProgress(db: Db, room: Room, now: Date): Promise<GoalProgress> {
  return goalProgress(db, room, now, new Date(latestDigestMoment(now).at.getTime() - WEEK_MS));
}

export async function setWeeklyGoal(db: Db, roomId: number, goal: number): Promise<void> {
  await db.update(rooms).set({ weeklyGoal: goal }).where(eq(rooms.id, roomId));
}

/** Комнаты, которые только что выполнили цель недели; помечает, чтобы поздравить один раз. */
export async function collectGoalsReached(db: Db, now: Date): Promise<Array<{ room: Room; progress: GoalProgress }>> {
  const week = latestDigestMoment(now);
  const result: Array<{ room: Room; progress: GoalProgress }> = [];
  const candidates = await db.select().from(rooms).where(or(isNull(rooms.goalReachedWeek), ne(rooms.goalReachedWeek, week.date)));
  for (const room of candidates) {
    const progress = await goalProgress(db, room, now, week.at);
    if (progress.done < progress.target) continue;
    await db.update(rooms).set({ goalReachedWeek: week.date }).where(eq(rooms.id, room.id));
    result.push({ room, progress });
  }
  return result;
}
