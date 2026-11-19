import { and, eq, gte, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs, type User } from "../db/schema";
import { localPartsFormatter } from "../time";
import { computeStreak } from "./stats";

const TIERS = [
  { days: 3, percent: 5 },
  { days: 7, percent: 10 },
  { days: 14, percent: 15 },
] as const;
const MAX_DAYS = TIERS[TIERS.length - 1].days;
const DAY_MS = 24 * 60 * 60_000;

export async function streakBuff(db: Db, user: Pick<User, "id" | "timezone">, now: Date, includeAnswerToday = false) {
  const local = localPartsFormatter(user.timezone);
  const today = local(now).date;
  const since = new Date(now.getTime() - (MAX_DAYS + 1) * DAY_MS);
  const logs = await db.select({ at: reviewLogs.reviewedAt }).from(reviewLogs)
    .where(and(eq(reviewLogs.userId, user.id), gte(reviewLogs.reviewedAt, since), lte(reviewLogs.reviewedAt, now)));
  const dates = new Set(logs.map(({ at }) => local(at).date));
  if (includeAnswerToday) dates.add(today);
  const days = Math.min(MAX_DAYS, computeStreak(dates, today));
  return {
    days,
    percent: TIERS.filter((tier) => tier.days <= days).at(-1)?.percent ?? 0,
    next: TIERS.find((tier) => tier.days > days) ?? null,
    tiers: TIERS,
  };
}
