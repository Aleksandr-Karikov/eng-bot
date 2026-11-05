import { asc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs } from "../db/schema";

type Direction = "en_ru" | "ru_en";

/** Не решаем по одной ошибке: нужны хотя бы два провала в одном направлении и два успеха в другом. */
export async function weakDirections(db: Db, cardIds: number[]): Promise<Map<number, Direction>> {
  const result = new Map<number, Direction>();
  if (cardIds.length === 0) return result;
  const logs = await db.select({ cardId: reviewLogs.cardId, stage: reviewLogs.stage, rating: reviewLogs.rating })
    .from(reviewLogs).where(inArray(reviewLogs.cardId, cardIds)).orderBy(asc(reviewLogs.id));
  const history = new Map<number, Record<Direction, string[]>>();
  for (const { cardId, stage, rating } of logs) {
    const direction = stage === "en_ru" || stage === "app_en_ru" ? "en_ru"
      : stage === "ru_en" || stage === "app_ru_en" ? "ru_en" : undefined;
    if (!direction) continue;
    const counts = history.get(cardId) ?? { en_ru: [], ru_en: [] };
    counts[direction].push(rating);
    counts[direction] = counts[direction].slice(-3);
    history.set(cardId, counts);
  }
  for (const [cardId, { en_ru, ru_en }] of history) {
    if (en_ru.length < 2 || ru_en.length < 2) continue;
    const failures = (ratings: string[]) => ratings.filter((r) => r === "again").length;
    const successes = (ratings: string[]) => ratings.filter((r) => r === "good" || r === "easy").length;
    if (failures(en_ru) >= 2 && successes(ru_en) >= 2) result.set(cardId, "en_ru");
    else if (failures(ru_en) >= 2 && successes(en_ru) >= 2) result.set(cardId, "ru_en");
  }
  return result;
}
