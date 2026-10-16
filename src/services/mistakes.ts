import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { mistakes, type Mistake } from "../db/schema";

const RECENT_LIMIT = 30;
const RECENT_DAYS = 60;
const EXAMPLES_PER_CATEGORY = 2;

/** Ошибки из /check, записываются тому, кто их совершил. */
export async function recordMistakes(
  db: Db,
  userId: number,
  fixes: Array<{ wrong: string; right: string; why?: string; category?: string }>,
  now: Date,
): Promise<void> {
  if (fixes.length === 0) return;
  await db.insert(mistakes).values(
    fixes.map((f) => ({ userId, category: f.category?.trim() || "другое", wrong: f.wrong, right: f.right, createdAt: now })),
  );
}

/** Последние ошибки за RECENT_DAYS, новые сверху — профиль строится только по ним, старое само забывается. */
export async function recentMistakes(db: Db, userId: number, now: Date): Promise<Mistake[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60_000);
  return db
    .select()
    .from(mistakes)
    .where(and(eq(mistakes.userId, userId), gte(mistakes.createdAt, since)))
    .orderBy(desc(mistakes.createdAt), desc(mistakes.id))
    .limit(RECENT_LIMIT);
}

export async function clearMistakes(db: Db, userId: number): Promise<void> {
  await db.delete(mistakes).where(eq(mistakes.userId, userId));
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
