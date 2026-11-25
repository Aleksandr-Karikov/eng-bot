import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { State } from "ts-fsrs";
import { makeUser, testDb } from "./helpers";

/**
 * Планы запросов, которые видны на горячем пути (E33).
 *
 * `nextReviewAt` спрашивает «когда следующее повторение» — его зовёт экран «Готово» после каждой
 * сессии. С индексом `(user_id, wordId)` запрос `WHERE user_id = ? ORDER BY due LIMIT 1` сортировал
 * ВСЕ карточки человека через временное B-tree, чтобы взять одну.
 */
describe("план запроса очереди (E33)", () => {
  it("nextReviewAt использует индекс (user_id, due) без временной сортировки", async () => {
    const db = testDb();
    const user = await makeUser(db, 1);
    const plan = db.all<{ detail: string }>(
      sql`EXPLAIN QUERY PLAN SELECT due FROM cards WHERE user_id = ${user.id} AND state <> ${State.New} ORDER BY due LIMIT 1`,
    );
    const text = plan.map((p) => p.detail).join(" | ");
    // Индекс должен покрывать и поиск, и порядок: иначе сортировка снова временная.
    expect(text).toContain("cards_user_due_idx");
    expect(text).not.toContain("TEMP B-TREE");
  });
});
