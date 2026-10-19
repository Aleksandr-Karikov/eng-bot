import { and, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, mistakes, reviewLogs, users, wordUses, words, type User } from "../db/schema";
import { digestDue, latestDigestMoment, WEEK_MS } from "./digest";
import { personalStats } from "./stats";

export interface WeeklyReport {
  reviews: number;
  /** Повторений на прошлой неделе — для сравнения. */
  reviewsBefore: number;
  /** Доля ответов «помню» (не «забыл»), %. */
  accuracy: number;
  /** Новых слов, впервые встреченных за неделю. */
  started: number;
  learned: number;
  streak: number;
  /** Слова, которые чаще всего забывались за неделю. */
  hardest: Array<{ term: string; forgot: number }>;
  /** Темы ошибок, закрытые за неделю. */
  resolvedTopics: string[];
  /** Слов комнаты, употреблённых в разговоре в группе. */
  usedInChat: number;
}

const HARDEST = 3;

export async function weeklyReport(db: Db, user: User, now: Date): Promise<WeeklyReport> {
  const end = latestDigestMoment(now).at;
  const start = new Date(end.getTime() - WEEK_MS);
  const before = new Date(start.getTime() - WEEK_MS);
  const logs = await db
    .select({ cardId: reviewLogs.cardId, rating: reviewLogs.rating, at: reviewLogs.reviewedAt, term: words.term })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(reviewLogs.userId, user.id), gte(reviewLogs.reviewedAt, before), lt(reviewLogs.reviewedAt, end)));
  const week = logs.filter((l) => l.at >= start);
  const forgot = new Map<string, number>();
  for (const l of week) if (l.rating === "again") forgot.set(l.term, (forgot.get(l.term) ?? 0) + 1);
  // Новое слово — у карточки нет ответов раньше этой недели. Берём по всей истории, а не только по прошлой неделе.
  // Одним запросом: у каких карточек недели были ответы раньше неё.
  const weekCards = [...new Set(week.map((l) => l.cardId))];
  const seenBefore = weekCards.length
    ? new Set(
        (
          await db
            .selectDistinct({ cardId: reviewLogs.cardId })
            .from(reviewLogs)
            .where(and(inArray(reviewLogs.cardId, weekCards), lt(reviewLogs.reviewedAt, start)))
        ).map((r) => r.cardId),
      )
    : new Set<number>();
  const started = weekCards.filter((id) => !seenBefore.has(id)).length;
  const resolved = await db
    .selectDistinct({ category: mistakes.category })
    .from(mistakes)
    .where(and(eq(mistakes.userId, user.id), isNotNull(mistakes.resolvedAt), gte(mistakes.resolvedAt, start), lt(mistakes.resolvedAt, end)));
  const uses = await db
    .select({ id: wordUses.id })
    .from(wordUses)
    .where(and(eq(wordUses.userId, user.id), gte(wordUses.createdAt, start), lt(wordUses.createdAt, end)));
  const stats = await personalStats(db, user, now);
  return {
    reviews: week.length,
    reviewsBefore: logs.length - week.length,
    accuracy: week.length ? Math.round((100 * week.filter((l) => l.rating !== "again").length) / week.length) : 0,
    started,
    learned: stats.learned,
    streak: stats.streak,
    hardest: [...forgot.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, HARDEST)
      .map(([term, n]) => ({ term, forgot: n })),
    resolvedTopics: resolved.map((r) => r.category),
    usedInChat: uses.length,
  };
}

/** Кому пора прислать личный итог (воскресенье 20:00, догоняет двое суток); помечает. Тихие недели пропускаются. */
export async function collectWeeklyReports(db: Db, now: Date): Promise<Array<{ user: User; report: WeeklyReport }>> {
  const result: Array<{ user: User; report: WeeklyReport }> = [];
  const candidates = await db.select().from(users).where(and(eq(users.canDm, true), eq(users.weeklyReport, true))).orderBy(desc(users.id));
  for (const user of candidates) {
    const date = digestDue({ lastDigestDate: user.lastReportDate }, now);
    if (!date) continue;
    await db.update(users).set({ lastReportDate: date }).where(eq(users.id, user.id));
    const report = await weeklyReport(db, user, now);
    if (report.reviews > 0 || report.usedInChat > 0) result.push({ user, report });
  }
  return result;
}
