import { and, asc, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, drillAnswers, mistakes, reviewLogs, type Room, type User } from "../db/schema";
import { localParts, nextDate, previousDate } from "../time";
import { goalProgress, type GoalProgress } from "./goals";
import { RESOLVE_STREAK, resolvedTopics } from "./mistakes";
import { personalStats, type PersonalStats } from "./stats";

/** Сколько дней показывать в календаре занятий (12 недель) и вперёд в прогнозе. */
const CALENDAR_DAYS = 84;
const FORECAST_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

export interface ProgressReport {
  stats: PersonalStats;
  /** Новых слов начато за 7 дней (первый ответ по карточке). */
  started7d: number;
  /** Ответов по дням (локальная дата → сколько), последние CALENDAR_DAYS дней, старые первыми. */
  calendar: Array<{ date: string; count: number }>;
  /** Сколько повторений придёт в ближайшие дни; просроченные — в сегодня. Новые слова не считаются. */
  forecast: Array<{ date: string; count: number }>;
  goal?: GoalProgress & { room: string };
  /** Открытые темы ошибок: сколько ошибок и сколько верных ответов подряд из RESOLVE_STREAK. */
  topics: Array<{ category: string; count: number; streak: number }>;
  resolveStreak: number;
  /** Отработанные за последнее время темы. */
  resolved: string[];
}

export async function progressReport(db: Db, user: User, room: Room | undefined, now: Date): Promise<ProgressReport> {
  const today = localParts(user.timezone, now).date;
  const since = new Date(now.getTime() - CALENDAR_DAYS * DAY_MS);
  const logs = await db
    .select({ cardId: reviewLogs.cardId, reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, user.id), gte(reviewLogs.reviewedAt, since)))
    .orderBy(asc(reviewLogs.id));

  const perDay = new Map<string, number>();
  for (const l of logs) {
    const date = localParts(user.timezone, l.reviewedAt).date;
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }
  const calendar: ProgressReport["calendar"] = [];
  let day = today;
  for (let i = 0; i < CALENDAR_DAYS; i++, day = previousDate(day)) calendar.unshift({ date: day, count: perDay.get(day) ?? 0 });

  // Начатые слова: карточки, у которых первый ответ вообще — в последние 7 дней.
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const firstAnswer = new Map<number, number>();
  const allFirst = await db.select({ cardId: reviewLogs.cardId, at: reviewLogs.reviewedAt }).from(reviewLogs).where(eq(reviewLogs.userId, user.id));
  for (const l of allFirst) {
    const prev = firstAnswer.get(l.cardId);
    if (prev === undefined || l.at.getTime() < prev) firstAnswer.set(l.cardId, l.at.getTime());
  }
  const started7d = [...firstAnswer.values()].filter((t) => t >= weekAgo).length;

  const due = await db
    .select({ due: cards.due })
    .from(cards)
    .where(and(eq(cards.userId, user.id), ne(cards.state, State.New)));
  const forecastDays: string[] = [];
  for (let i = 0, d = today; i < FORECAST_DAYS; i++, d = nextDate(d)) forecastDays.push(d);
  const perDue = new Map<string, number>();
  for (const c of due) {
    const date = c.due.getTime() <= now.getTime() ? today : localParts(user.timezone, c.due).date;
    perDue.set(date, (perDue.get(date) ?? 0) + 1);
  }
  const forecast = forecastDays.map((date) => ({ date, count: perDue.get(date) ?? 0 }));

  return {
    stats: await personalStats(db, user, now),
    started7d,
    calendar,
    forecast,
    goal: room ? { room: room.name, ...(await goalProgress(db, room, now)) } : undefined,
    topics: await openTopics(db, user.id),
    resolveStreak: RESOLVE_STREAK,
    resolved: [...(await resolvedTopics(db, user.id, now)).keys()],
  };
}

/** Открытые темы: ошибок в теме и верных ответов подряд после последней новой ошибки — как в recordDrillAnswer. */
async function openTopics(db: Db, userId: number): Promise<ProgressReport["topics"]> {
  const open = await db
    .select({ category: mistakes.category, createdAt: mistakes.createdAt })
    .from(mistakes)
    .where(and(eq(mistakes.userId, userId), isNull(mistakes.resolvedAt)))
    .orderBy(desc(mistakes.createdAt));
  const topics = new Map<string, { count: number; latest: Date }>();
  for (const m of open) {
    const t = topics.get(m.category);
    if (t) t.count++;
    else topics.set(m.category, { count: 1, latest: m.createdAt });
  }
  const result: ProgressReport["topics"] = [];
  for (const [category, { count, latest }] of topics) {
    const answers = await db
      .select({ correct: drillAnswers.correct })
      .from(drillAnswers)
      .where(and(eq(drillAnswers.userId, userId), eq(drillAnswers.category, category), gte(drillAnswers.createdAt, latest)))
      .orderBy(desc(drillAnswers.createdAt), desc(drillAnswers.id));
    let streak = 0;
    while (streak < answers.length && answers[streak].correct) streak++;
    result.push({ category, count, streak });
  }
  return result.sort((a, b) => b.count - a.count);
}
