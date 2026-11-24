import { describe, expect, it } from "vitest";
import { digestText } from "../src/bot/texts";
import { eq } from "drizzle-orm";
import { reviewLogs, users } from "../src/db/schema";
import { DEFAULT_GOAL_HP, collectGoalsReached, goalProgress, markGoalReached, setWeeklyGoal } from "../src/services/goals";
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
  // Цель фиксированная: прошлая неделя в неё не входит (E3 — иначе прокачка сжимала бы цель,
  // E4 — иначе честные «Забыл» её раздували). Число одно и то же при любом прошлом.
  it("goal is fixed and does not depend on last week", () => {
    expect(DEFAULT_GOAL_HP).toBe(100);
  });

  it("counts this week's reviews of the room by member, against a fixed or a set goal", async () => {
    const h = botHarness();
    const { alice, bob, room, review } = await setup(h.db);
    // Прошлая неделя намеренно огромная: при прежней формуле она дала бы цель 140 HP, а при
    // фиксированной — не влияет вовсе. Это и есть суть E3 и E4.
    await review(alice.id, nsk("2026-10-15T12:00"), 60);
    await review(alice.id, nsk("2026-10-19T09:00"), 3);
    await review(bob.id, nsk("2026-10-19T10:00"), 5);
    const now = nsk("2026-10-19T12:00");
    // Урон — в HP: 8 ответов этого человека × вес 2. Цель не зависит от прошлой недели.
    expect(await goalProgress(h.db, room, now)).toEqual({ target: 100, done: 16, auto: true, byUser: [{ name: "Bob", count: 10 }, { name: "Alice", count: 6 }] });
    await setWeeklyGoal(h.db, room.id, 8);
    const fresh = (await getRoom(h.db, room.id))!;
    expect((await goalProgress(h.db, fresh, now)).target).toBe(8);
    // Цель выполнена — поздравляем один раз за неделю. Отметка ставится после доставки,
    // а не в коллекторе: иначе сбой Telegram съедал поздравление навсегда.
    const reached = await collectGoalsReached(h.db, now);
    expect(reached.map((r) => r.room.id)).toEqual([room.id]);
    for (const r of reached) await markGoalReached(h.db, r.room.id, r.date);
    expect(await collectGoalsReached(h.db, now)).toEqual([]);
  });

  it("/goal sets and shows the goal with a progress bar", async () => {
    const h = botHarness();
    await setup(h.db);
    await h.bot.handleUpdate(h.message(100, "/goal 300"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    expect(text).toContain("/300 HP");
    expect(text).toContain("░░░░░░░░░░");
    await h.bot.handleUpdate(h.message(100, "/goal много"));
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Формат: /goal 600");
  });

  it("the digest tells whether the goal was reached", () => {
    const goal = { target: 100, done: 120, auto: true, byUser: [] };
    expect(digestText("R", [{ name: "A", added: 0, reviews7d: 120, learned: 0, streak: 0 }], [], goal)).toContain("🎯 Цель недели: 120/100 ✅");
  });
});

describe("цель недели не зависит от усиления и от прошлой недели", () => {
  /** Комната с прошлой неделей из `past` ответов и усилением `level`: цель должна быть одинаковой. */
  const targetFor = async (db: ReturnType<typeof botHarness>["db"], past: number, level: number) => {
    const alice = await makeUser(db, 700 + past + level, "Alice");
    const room = await createRoom(db, { name: `R${past}-${level}`, createdBy: alice.id, now: nsk("2026-10-05T10:00") });
    await updateUser(db, alice.id, { currentRoomId: room.id });
    // Усиление задаётся напрямую: updateUser его не принимает, это поле покупается за монеты.
    await db.update(users).set({ upgradeDamage: level }).where(eq(users.id, alice.id));
    const saved = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: `w${past}${level}`, translation: "t", explanation: "", example: "" }, now: nsk("2026-10-05T10:00") });
    if (saved.status !== "saved") throw new Error("not saved");
    for (let i = 0; i < past; i++) {
      await db.insert(reviewLogs).values({ userId: alice.id, cardId: saved.word.id, rating: "good", reviewedAt: nsk("2026-10-15T12:00") });
    }
    const fresh = (await getRoom(db, room.id))!;
    return (await goalProgress(db, fresh, nsk("2026-10-19T12:00"))).target;
  };

  // E3: усиление поднимает урон за ответ, поэтому за ТОТ ЖЕ урон усиленный человек отвечает меньше раз.
  // Прежняя формула считала цель от числа ответов — и давала ему цель вдвое меньше за ту же работу.
  it("одинаковый урон даёт одинаковую цель при разном усилении", async () => {
    const h = botHarness();
    // Уровень 0: 200 ответов по 2 HP = 400 HP. Уровень 10 (+100%): 100 ответов по 4 HP = те же 400 HP.
    expect(await targetFor(h.db, 200, 0)).toBe(await targetFor(h.db, 100, 10));
    // Обе цели — фиксированные, а не «сколько получилось по прошлой неделе».
    expect(await targetFor(h.db, 200, 0)).toBe(100);
  });

  // E4: раньше `raw` считал все ответы подряд, включая «Забыл», то есть честность повышала цель.
  it("прошлая неделя с преобладанием «Забыл» не раздувает цель", async () => {
    const h = botHarness();
    const alice = await makeUser(h.db, 900, "Alice");
    const room = await createRoom(h.db, { name: "Rfail", createdBy: alice.id, now: nsk("2026-10-05T10:00") });
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    const saved = await saveWord(h.db, { roomId: room.id, addedBy: alice.id, draft: { term: "fail", translation: "t", explanation: "", example: "" }, now: nsk("2026-10-05T10:00") });
    if (saved.status !== "saved") throw new Error("not saved");
    for (let i = 0; i < 200; i++) {
      await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: saved.word.id, rating: "again", reviewedAt: nsk("2026-10-15T12:00") });
    }
    const fresh = (await getRoom(h.db, room.id))!;
    const goal = await goalProgress(h.db, fresh, nsk("2026-10-19T12:00"));
    expect(goal.target).toBe(100);
    expect(goal.auto).toBe(true);
  });
});
