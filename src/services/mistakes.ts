import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { drillAnswers, mistakes, type Mistake } from "../db/schema";

/** Столько верных ответов подряд по теме — и она отработана: её ошибки больше не предлагаются. */
export const RESOLVE_STREAK = 3;

const RECENT_LIMIT = 30;
const RECENT_DAYS = 60;
const EXAMPLES_PER_CATEGORY = 2;

/** Ошибки из /check, записываются тому, кто их совершил. */
export async function recordMistakes(
  db: Db,
  userId: number,
  fixes: Array<{ wrong: string; right: string; why?: string; category?: string; slip?: boolean }>,
  now: Date,
): Promise<void> {
  // Описки показываем в /check, но в работу над ошибками не берём — это не пробел в знаниях.
  const real = fixes.filter((f) => !f.slip);
  if (real.length === 0) return;
  await db.insert(mistakes).values(
    real.map((f) => ({ userId, category: f.category?.trim() || "другое", wrong: f.wrong, right: f.right, createdAt: now })),
  );
}

/** Неотработанные ошибки за RECENT_DAYS, новые сверху — профиль строится только по ним, старое само забывается. */
export async function recentMistakes(db: Db, userId: number, now: Date): Promise<Mistake[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60_000);
  return db
    .select()
    .from(mistakes)
    .where(and(eq(mistakes.userId, userId), gte(mistakes.createdAt, since), isNull(mistakes.resolvedAt)))
    .orderBy(desc(mistakes.createdAt), desc(mistakes.id))
    .limit(RECENT_LIMIT);
}

export async function clearMistakes(db: Db, userId: number): Promise<void> {
  await db.delete(mistakes).where(eq(mistakes.userId, userId));
  await db.delete(drillAnswers).where(eq(drillAnswers.userId, userId));
}

/** Темы, отработанные за RECENT_DAYS: тема → сколько ошибок в ней закрыто. */
export async function resolvedTopics(db: Db, userId: number, now: Date): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60_000);
  const rows = await db
    .select({ category: mistakes.category })
    .from(mistakes)
    .where(and(eq(mistakes.userId, userId), isNotNull(mistakes.resolvedAt), gte(mistakes.resolvedAt, since)));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return counts;
}

export interface DrillProgress {
  category: string;
  /** Верных ответов подряд по теме — после последней новой ошибки в ней. */
  streak: number;
  /** Этим ответом тема отработана. */
  resolved: boolean;
}

/**
 * Записывает ответ на вопрос по теме. Верные ответы подряд копятся, ошибка обнуляет счёт;
 * новая ошибка из /check тоже начинает счёт заново. На RESOLVE_STREAK тема закрывается.
 * undefined — по этой теме нет открытых ошибок (вопрос мог быть подготовлен раньше).
 */
export async function recordDrillAnswer(db: Db, userId: number, questionCategory: string, correct: boolean, now: Date): Promise<DrillProgress | undefined> {
  const open = await db
    .select({ category: mistakes.category, createdAt: mistakes.createdAt })
    .from(mistakes)
    .where(and(eq(mistakes.userId, userId), isNull(mistakes.resolvedAt)))
    .orderBy(desc(mistakes.createdAt));
  const wanted = questionCategory.trim().toLowerCase();
  const match = open.find((m) => m.category.toLowerCase() === wanted) ?? open.find((m) => wanted && m.category.toLowerCase().startsWith(wanted));
  if (!match) return undefined;
  const category = match.category;
  await db.insert(drillAnswers).values({ userId, category, correct, createdAt: now });
  const answers = await db
    .select({ correct: drillAnswers.correct })
    .from(drillAnswers)
    .where(and(eq(drillAnswers.userId, userId), eq(drillAnswers.category, category), gte(drillAnswers.createdAt, match.createdAt)))
    .orderBy(desc(drillAnswers.createdAt), desc(drillAnswers.id));
  let streak = 0;
  while (streak < answers.length && answers[streak].correct) streak++;
  const resolved = streak >= RESOLVE_STREAK;
  if (resolved) {
    await db
      .update(mistakes)
      .set({ resolvedAt: now })
      .where(and(eq(mistakes.userId, userId), eq(mistakes.category, category), isNull(mistakes.resolvedAt)));
  }
  return { category, streak, resolved };
}

export interface MistakeProfile {
  total: number;
  categories: Array<{ category: string; count: number; examples: Array<{ wrong: string; right: string }> }>;
  /** Текст для промпта Claude: «тема ×n: как было → как правильно; …» по строке на тему. */
  text: string;
}

/** recent — новые сверху (как отдаёт recentMistakes); темы — по частоте. */
export function mistakeProfile(recent: Mistake[]): MistakeProfile {
  const byCategory = new Map<string, Mistake[]>();
  for (const m of recent) byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m]);
  const categories = [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      count: list.length,
      examples: list.slice(0, EXAMPLES_PER_CATEGORY).map((m) => ({ wrong: m.wrong, right: m.right })),
    }))
    .sort((a, b) => b.count - a.count);
  const text = categories
    .map((c) => `${c.category} ×${c.count}: ${c.examples.map((e) => `${e.wrong} → ${e.right}`).join("; ")}`)
    .join("\n");
  return { total: recent.length, categories, text };
}
