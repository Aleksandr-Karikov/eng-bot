import type { Db } from "../db/client";
import { cards } from "../db/schema";
import { newCard } from "../srs/srs";

const CHUNK = 200;

export async function createCards(db: Db, userIds: number[], wordIds: number[], now: Date): Promise<void> {
  const rows = userIds.flatMap((userId) => wordIds.map((wordId) => ({ userId, wordId, createdAt: now, ...newCard(now) })));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(cards).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}
