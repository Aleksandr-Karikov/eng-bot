import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pendingExercises } from "../db/schema";
import type { ExercisePersistence, PendingExercise } from "../bot/exercises";

/** Ожидания ответа на упражнения — в базе, чтобы перезапуск бота не превращал ответ в «новое слово». */
export function dbExercisePersistence(db: Db): ExercisePersistence {
  return {
    async load() {
      const rows = await db.select().from(pendingExercises);
      return rows.map((r) => ({ userId: r.userId, exercise: JSON.parse(r.data) as PendingExercise, since: r.since.getTime() }));
    },
    async save(userId, exercise, since) {
      await db.delete(pendingExercises).where(eq(pendingExercises.userId, userId));
      if (exercise) await db.insert(pendingExercises).values({ userId, data: JSON.stringify(exercise), since: new Date(since) });
    },
  };
}
