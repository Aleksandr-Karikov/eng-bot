import { count, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, users } from "../db/schema";

const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface UserRow {
  id: number;
  telegramId: number;
  firstName: string;
  username: string | null;
  /** Откуда пришёл (`?start=`); null — был в боте до появления колонки. */
  source: string | null;
  createdAt: Date;
  /** Сколько карточек (слов) у человека. */
  words: number;
  /** Повторения за последние 7 дней. */
  reviews7d: number;
}

/**
 * Список пользователей для админа (/users). Только чтение.
 *
 * Активность (слова, повторения за неделю) считается агрегацией в SQL (`count` + `groupBy`), а не
 * запросом на человека: N+1 на сотню пользователей — это N+1 лишних обращений к базе.
 */
export async function listUsers(db: Db, now: Date): Promise<UserRow[]> {
  const all = await db.select().from(users);
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  const wordCounts = await db.select({ userId: cards.userId, n: count() }).from(cards).groupBy(cards.userId);
  const reviewCounts = await db
    .select({ userId: reviewLogs.userId, n: count() })
    .from(reviewLogs)
    .where(gte(reviewLogs.reviewedAt, weekAgo))
    .groupBy(reviewLogs.userId);

  const wordsByUser = new Map(wordCounts.map((r) => [r.userId, r.n]));
  const reviewsByUser = new Map(reviewCounts.map((r) => [r.userId, r.n]));

  return all
    .map((u) => ({
      id: u.id,
      telegramId: u.telegramId,
      firstName: u.firstName,
      username: u.username,
      source: u.source,
      createdAt: u.createdAt,
      words: wordsByUser.get(u.id) ?? 0,
      reviews7d: reviewsByUser.get(u.id) ?? 0,
    }))
    // Новые — сверху: админу важнее видеть, кто недавно пришёл, чем кто был первым.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
