import { describe, expect, it } from "vitest";
import { digestText } from "../src/bot/texts";
import { reviewLogs } from "../src/db/schema";
import { autoGoal, collectGoalsReached, goalProgress, setWeeklyGoal } from "../src/services/goals";
import { createRoom, getRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { makeUser } from "./helpers";

// Новосибирск = UTC+7. 2026-10-18 — воскресенье, неделя начинается в 20:00.
const nsk = (iso: string) => new Date(`${iso}+07:00`);

async function setup(db: ReturnType<typeof botHarness>["db"]) {
  const alice = await updateUser(db, (await makeUser(db, 100, "Alice")).id, { canDm: true });
  const bob = await makeUser(db, 200, "Bob");
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: nsk("2026-10-01T10:00") });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: nsk("2026-10-01T10:00"), makeCurrent: true });
  const saved = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: nsk("2026-10-01T10:00") });
  if (saved.status !== "saved") throw new Error("not saved");
  const review = async (userId: number, at: Date, n = 1) => {
    for (let i = 0; i < n; i++) await db.insert(reviewLogs).values({ userId, cardId: userId === alice.id ? 1 : 2, rating: "good", reviewedAt: at });
  };
  return { alice, bob, room, review };
}

describe("🎯 room goal for the week", () => {
  it("auto goal grows 10% over last week, at least 50", () => {
    expect(autoGoal(0)).toBe(50);
    expect(autoGoal(200)).toBe(220);
    expect(autoGoal(101)).toBe(120);
  });

  it("counts this week's reviews of the room by member, against an auto or a set goal", async () => {
    const h = botHarness();
    const { alice, bob, room, review } = await setup(h.db);
    await review(alice.id, nsk("2026-10-15T12:00"), 60); // прошлая неделя
    await review(alice.id, nsk("2026-10-19T09:00"), 3);
    await review(bob.id, nsk("2026-10-19T10:00"), 5);
    const now = nsk("2026-10-19T12:00");
    expect(await goalProgress(h.db, room, now)).toEqual({ target: 70, done: 8, auto: true, byUser: [{ name: "Bob", count: 5 }, { name: "Alice", count: 3 }] });
    await setWeeklyGoal(h.db, room.id, 8);
    const fresh = (await getRoom(h.db, room.id))!;
    expect((await goalProgress(h.db, fresh, now)).target).toBe(8);
    // Цель выполнена — поздравляем один раз за неделю.
    expect((await collectGoalsReached(h.db, now)).map((r) => r.room.id)).toEqual([room.id]);
    expect(await collectGoalsReached(h.db, now)).toEqual([]);
  });

  it("/goal sets and shows the goal with a progress bar", async () => {
    const h = botHarness();
    await setup(h.db);
    await h.bot.handleUpdate(h.message(100, "/goal 300"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    expect(text).toContain("/300 повторений");
    expect(text).toContain("░░░░░░░░░░");
    await h.bot.handleUpdate(h.message(100, "/goal много"));
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Формат: /goal 300");
  });

  it("the digest tells whether the goal was reached", () => {
    const goal = { target: 100, done: 120, auto: true, byUser: [] };
    expect(digestText("R", [{ name: "A", added: 0, reviews7d: 120, learned: 0, streak: 0 }], [], goal)).toContain("🎯 Цель недели: 120/100 ✅");
  });
});
