import { describe, expect, it } from "vitest";
import { goalReachedText } from "../src/bot/texts";
import { sendGoalsReached } from "../src/reminder-loop";
import { setWeeklyGoal } from "../src/services/goals";
import { createRoom, joinRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { reviewLogs } from "../src/db/schema";
import type { User } from "../src/db/schema";
import { botHarness } from "./bot-harness";
import { makeUser } from "./helpers";

const nsk = (iso: string) => new Date(`${iso}+07:00`);

/** Комната на двоих, где цель недели уже добита: один бьёт, второй режим выключил себе. */
async function roomWithWin() {
  const h = botHarness();
  const alice = await updateUser(h.db, (await makeUser(h.db, 1, "Alice")).id, { canDm: true, modeBoss: true });
  const bob = await updateUser(h.db, (await makeUser(h.db, 2, "Bob")).id, { canDm: true, modeBoss: false });
  const room = await createRoom(h.db, { name: "Друзья", createdBy: alice.id, now: nsk("2026-10-12T10:00") });
  await joinRoom(h.db, { roomId: room.id, userId: alice.id, now: nsk("2026-10-12T10:00"), makeCurrent: true });
  await joinRoom(h.db, { roomId: room.id, userId: bob.id, now: nsk("2026-10-12T10:00"), makeCurrent: true });
  const saved = await saveWord(h.db, { roomId: room.id, addedBy: alice.id, draft: { term: "w", translation: "t", explanation: "", example: "" }, now: nsk("2026-10-12T10:00") });
  if (saved.status !== "saved") throw new Error("fixture");
  await setWeeklyGoal(h.db, room.id, 4);
  // Добивающий удар внутри ТЕКУЩЕЙ недели комнаты: неделя начинается в воскресенье 20:00,
  // поэтому ответ ставится позже этой границы (иначе он попадёт в прошлую неделю).
  await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 44, reviewedAt: nsk("2026-10-26T10:00") });
  return { h, alice, bob, room };
}

function fakeNotifier() {
  const dms: Array<{ to: string; text: string }> = [];
  const groups: Array<{ chatId: number; text: string }> = [];
  return {
    dms, groups,
    dm: async (user: User, text: string) => (dms.push({ to: user.firstName, text }), true),
    group: async (chatId: number, text: string) => (groups.push({ chatId, text }), true),
  };
}

describe("победа в чате: добивающий удар и фильтр получателей (E12)", () => {
  it("текст называет того, кто добил", () => {
    const goal = { target: 100, done: 120, auto: true, byUser: [{ name: "Alice", count: 120 }] };
    // Без удара — прежний отчёт по цели.
    expect(goalReachedText("R", goal)).not.toContain("Добил");
    // С ударом — имя того, кто закрыл бой.
    const withBlow = goalReachedText("R", goal, { name: "Alice" });
    expect(withBlow).toContain("Добил(а): <b>Alice</b>");
    expect(withBlow).toContain("босс повержен");
  });

  it("в личку не пишет тому, кто выключил режим, а в группу — пишет всем", async () => {
    const { h, room } = await roomWithWin();
    // Группы нет: значит доставка идёт в личку — и только тем, у кого режим включён.
    const notifier = fakeNotifier();
    await sendGoalsReached({ db: h.db, notifier, now: () => nsk("2026-10-27T10:00") });
    expect(notifier.dms.map((d) => d.to)).toEqual(["Alice"]);
    expect(notifier.dms[0]?.text).toContain("Добил(а)");

    // А в привязанную группу сообщение уходит целиком: там читают и те, кто не играет.
    const second = await roomWithWin();
    await linkGroup(second.h.db, second.room.id, -100);
    const withGroup = fakeNotifier();
    await sendGoalsReached({ db: second.h.db, notifier: withGroup, now: () => nsk("2026-10-27T10:00") });
    expect(withGroup.groups).toHaveLength(1);
    expect(withGroup.groups[0]?.text).toContain("Добил(а)");
    expect(withGroup.dms).toEqual([]);
  });

  it("при выключенном рубильнике в личку не уходит никому", async () => {
    const { h } = await roomWithWin();
    const notifier = fakeNotifier();
    await sendGoalsReached({ db: h.db, notifier, now: () => nsk("2026-10-27T10:00"), bossEnabled: false });
    expect(notifier.dms).toEqual([]);
  });
});
