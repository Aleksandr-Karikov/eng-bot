import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard } from "../src/services/review";
import { computeStreak, personalStats, roomLeaderboard } from "../src/services/stats";
import { saveWord } from "../src/services/words";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

describe("computeStreak", () => {
  it("counts consecutive days ending today or yesterday", () => {
    expect(computeStreak(new Set(["2026-10-13", "2026-10-14", "2026-10-15"]), "2026-10-15")).toBe(3);
    expect(computeStreak(new Set(["2026-10-13", "2026-10-14"]), "2026-10-15")).toBe(2);
    expect(computeStreak(new Set(["2026-10-12"]), "2026-10-15")).toBe(0);
    expect(computeStreak(new Set(), "2026-10-15")).toBe(0);
  });
});

describe("stats", () => {
  it("computes personal stats and the room leaderboard", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1, "Alice");
    const bob = await makeUser(db, 2, "Bob");
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    for (const term of ["a", "b", "c"]) {
      await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now: T0 });
    }
    // Bob отвечает на две карточки в два разных дня.
    const bobCards = await db.select().from(cards).where(eq(cards.userId, bob.id)).orderBy(cards.id);
    await answerCard(db, { userId: bob.id, cardId: bobCards[0].id, expectedReps: 0, answer: "good", now: at(-DAY) });
    await answerCard(db, { userId: bob.id, cardId: bobCards[1].id, expectedReps: 0, answer: "good", now: T0 });
    // Делаем первую карточку «выученной».
    await db.update(cards).set({ state: 2, stability: 30 }).where(eq(cards.id, bobCards[0].id));

    const s = await personalStats(db, bob, T0);
    expect(s).toEqual({ total: 3, learned: 1, learning: 1, fresh: 1, reviews7d: 2, streak: 2 });

    const board = await roomLeaderboard(db, room.id, T0);
    expect(board.map((r) => r.name)).toEqual(["Bob", "Alice"]);
    expect(board[0]).toMatchObject({ learned: 1, reviews7d: 2 });
  });
});
