import { and, asc, countDistinct, eq, gt, gte, isNotNull, lt, notExists, notLike, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { combatArchive, combatSpends, reviewLogs, users } from "../db/schema";

const pending = new WeakMap<Db, Promise<unknown>>();
export const GRAMMAR_STRIKE_PREFIX = "grammar:";

// shortcut: один процесс бота, при нескольких писателях нужен условный дебет в БД.
export async function withCombatLock<T>(db: Db, action: () => Promise<T>): Promise<T> {
  const task = (pending.get(db) ?? Promise.resolve()).then(action);
  const settled = task.catch(() => {});
  pending.set(db, settled);
  try {
    return await task;
  } finally {
    if (pending.get(db) === settled) pending.delete(db);
  }
}

export async function damageBalanceDeci(db: Db, userId: number): Promise<number> {
  const archived = db.select({ total: sql<number>`coalesce(sum(${combatArchive.damageDeci}), 0)` }).from(combatArchive)
    .where(eq(combatArchive.userId, userId));
  const earned = db.select({ total: sql<number>`coalesce(sum(${reviewLogs.damageDeci}), 0)` }).from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.banked, true), notExists(
      db.select({ id: combatArchive.reviewId }).from(combatArchive).where(eq(combatArchive.reviewId, reviewLogs.id)),
    )));
  const spent = db.select({ total: sql<number>`coalesce(sum(${combatSpends.damageDeci}), 0)` }).from(combatSpends)
    // В старых ударах грамматики в damageDeci записан нанесённый урон, а расход энергии равен нулю.
    .where(and(eq(combatSpends.userId, userId), notLike(combatSpends.requestId, `${GRAMMAR_STRIKE_PREFIX}%`)));
  const [row] = await db.select({ balance: sql<number>`(${earned}) + (${archived}) - (${spent})` }).from(users).where(eq(users.id, userId));
  return Math.max(0, row?.balance ?? 0);
}

export function removeReviewHistory(db: Db, filter: SQL) {
  return withCombatLock(db, async () => {
    await db.insert(combatArchive).select(
      db.select({
        reviewId: reviewLogs.id,
        userId: reviewLogs.userId,
        damageDeci: sql<number>`coalesce(${reviewLogs.damageDeci}, 0)`.as("damage_deci"),
      }).from(reviewLogs).where(and(filter, eq(reviewLogs.banked, true))),
    ).onConflictDoNothing();
    await db.delete(reviewLogs).where(filter);
  });
}

export function bossStrikes(db: Db, roomId: number, from: Date, to: Date) {
  const damage = sql<number>`coalesce(${combatSpends.bossDamageDeci}, ${combatSpends.damageDeci})`;
  return db.select({
    userId: users.id, name: users.firstName, at: combatSpends.at,
    damageDeci: damage,
  })
    .from(combatSpends).innerJoin(users, eq(users.id, combatSpends.userId))
    .where(and(eq(combatSpends.target, "boss"), eq(combatSpends.roomId, roomId), gt(damage, 0), gte(combatSpends.at, from), lt(combatSpends.at, to)))
    .orderBy(asc(combatSpends.at), asc(combatSpends.id));
}

export async function availableRune(db: Db, user: Pick<typeof users.$inferSelect, "id" | "runesBought">): Promise<number | null> {
  if (user.runesBought === 0) return null;
  const [hit] = await db.select({ id: combatSpends.id }).from(combatSpends)
    .where(and(eq(combatSpends.userId, user.id), eq(combatSpends.runeSerial, user.runesBought))).limit(1);
  return hit ? null : user.runesBought;
}

export function mobClaims(db: Db, userId: number, week: string) {
  return db.select({ target: combatSpends.target }).from(combatSpends)
    .where(and(eq(combatSpends.userId, userId), eq(combatSpends.mobWeek, week)));
}

export async function mobHuntWeeks(db: Db, userId: number): Promise<number> {
  const [row] = await db.select({ weeks: countDistinct(combatSpends.mobWeek) }).from(combatSpends)
    .where(and(eq(combatSpends.userId, userId), isNotNull(combatSpends.mobWeek)));
  return row?.weeks ?? 0;
}
