import { eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, mistakes, reviewLogs, users, words } from "../db/schema";
import { STAGES } from "./exercises";

const WINDOW_MS = 30 * 24 * 60 * 60_000;

export interface TrainerReport {
  byStage: Array<{ stage: string; answers: number; forgot: number }>;
  /** Первый в истории ответ на карточку: как часто новое слово забывают сразу. */
  firstShow: { cards: number; forgot: number };
  hardWords: Array<{ term: string; forgot: number }>;
  people: Array<{ name: string; answers: number; forgot: number }>;
  mistakeTopics: Array<{ category: string; count: number }>;
}

/** Сводка по тренажёру за 30 дней — чтобы решать про упражнения по данным. Только чтение. */
export async function trainerReport(db: Db, now: Date): Promise<TrainerReport> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const logs = await db
    .select({ cardId: reviewLogs.cardId, rating: reviewLogs.rating, stage: reviewLogs.stage, at: reviewLogs.reviewedAt, user: users.firstName, term: words.term })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id));
  const recent = logs.filter((l) => l.at >= since);
  const forgot = (l: { rating: string }) => l.rating === "again";

  const order = [...STAGES, "know"] as string[];
  const stages = [...new Set(recent.map((l) => l.stage).filter((s): s is string => !!s))].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  const byStage = stages.map((stage) => {
    const ls = recent.filter((l) => l.stage === stage);
    return { stage, answers: ls.length, forgot: ls.filter(forgot).length };
  });

  const firstByCard = new Map<number, (typeof logs)[number]>();
  for (const l of [...logs].sort((a, b) => a.at.getTime() - b.at.getTime())) if (!firstByCard.has(l.cardId)) firstByCard.set(l.cardId, l);
  const firsts = [...firstByCard.values()].filter((l) => l.at >= since);

  const count = <K>(items: K[]) => {
    const m = new Map<K, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const people = [...new Set(recent.map((l) => l.user))]
    .map((name) => {
      const ls = recent.filter((l) => l.user === name);
      return { name, answers: ls.length, forgot: ls.filter(forgot).length };
    })
    .sort((a, b) => b.answers - a.answers);

  const recentMistakes = await db.select({ category: mistakes.category }).from(mistakes).where(gte(mistakes.createdAt, since));

  return {
    byStage,
    firstShow: { cards: firsts.length, forgot: firsts.filter(forgot).length },
    hardWords: count(recent.filter(forgot).map((l) => l.term)).slice(0, 10).map(([term, n]) => ({ term, forgot: n })),
    people,
    mistakeTopics: count(recentMistakes.map((m) => m.category)).map(([category, n]) => ({ category, count: n })),
  };
}
