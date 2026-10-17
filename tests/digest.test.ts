import { describe, expect, it } from "vitest";
import type { User } from "../src/db/schema";
import { digestText, reminderText } from "../src/bot/texts";
import { sendDigests, sendReminders } from "../src/reminder-loop";
import { collectDigests, digestDue } from "../src/services/digest";
import { answerCard, nextDue } from "../src/services/review";
import { createRoom, joinRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { DAY, makeUser, testDb } from "./helpers";

// Новосибирск = UTC+7. 2026-10-18 — воскресенье.
const nsk = (iso: string) => new Date(`${iso}+07:00`);

function fakeNotifier() {
  const dms: Array<{ to: string; text: string }> = [];
  const groups: Array<{ chatId: number; text: string }> = [];
  return {
    dms,
    groups,
    dm: async (user: User, text: string) => (dms.push({ to: user.firstName, text }), true),
    group: async (chatId: number, text: string) => (groups.push({ chatId, text }), true),
  };
}

async function setup() {
  const db = testDb();
  const alice = await updateUser(db, (await makeUser(db, 1, "Alice")).id, { canDm: true });
  const bob = await updateUser(db, (await makeUser(db, 2, "Bob")).id, { canDm: true });
  const room = await createRoom(db, { name: "Друзья", createdBy: alice.id, now: nsk("2026-10-12T10:00") });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: nsk("2026-10-12T10:00"), makeCurrent: true });
  for (const term of ["a", "b", "c"]) {
    await saveWord(db, { roomId: room.id, addedBy: bob.id, draft: { term, translation: "t", explanation: "", example: "" }, now: nsk("2026-10-15T10:00") });
  }
  return { db, alice, bob, room };
}

async function review(db: ReturnType<typeof testDb>, userId: number, times: number, at: Date) {
  for (let i = 0; i < times; i++) {
    const item = (await nextDue(db, userId, new Date(at.getTime() + DAY)))!;
    await answerCard(db, { userId, cardId: item.card.id, expectedReps: item.card.reps, answer: "again", now: at });
  }
}

describe("digest schedule", () => {
  it("is due on Sunday from 20:00 Novosibirsk, once", () => {
    const room = { lastDigestDate: null as string | null };
    expect(digestDue(room, nsk("2026-10-18T19:59"))).toBeNull();
    expect(digestDue(room, nsk("2026-10-18T20:00"))).toBe("2026-10-18");
    expect(digestDue({ lastDigestDate: "2026-10-18" }, nsk("2026-10-18T21:00"))).toBeNull();
    expect(digestDue({ lastDigestDate: "2026-10-18" }, nsk("2026-10-19T20:00"))).toBeNull();
  });
});

describe("weekly digest", () => {
  it("summarizes the week per member and picks the hero", async () => {
    const { db, alice, bob } = await setup();
    await review(db, bob.id, 3, nsk("2026-10-16T12:00"));
    await review(db, alice.id, 1, nsk("2026-10-17T12:00"));
    const [digest] = await collectDigests(db, nsk("2026-10-18T20:00"));
    expect(digest.room.name).toBe("Друзья");
    expect(digest.rows.map((r) => [r.name, r.added, r.reviews7d])).toEqual([
      ["Bob", 3, 3],
      ["Alice", 0, 1],
    ]);
    const text = digestText(digest.room.name, digest.rows);
    expect(text).toContain("Итоги недели");
    expect(text).toContain("Герой недели: <b>Bob</b>");
    expect(await collectDigests(db, nsk("2026-10-18T20:05"))).toEqual([]);
  });

  it("skips a room where nobody did anything this week", async () => {
    const { db } = await setup();
    expect(await collectDigests(db, nsk("2026-10-25T20:00"))).toEqual([]);
  });

  it("posts to the linked group, otherwise DMs every member", async () => {
    const a = await setup();
    await review(a.db, a.bob.id, 1, nsk("2026-10-17T12:00"));
    const toDms = fakeNotifier();
    await sendDigests({ db: a.db, notifier: toDms, now: () => nsk("2026-10-18T20:00") });
    expect(toDms.dms.map((d) => d.to).sort()).toEqual(["Alice", "Bob"]);

    const b = await setup();
    await linkGroup(b.db, b.room.id, -900);
    await review(b.db, b.bob.id, 1, nsk("2026-10-17T12:00"));
    const toGroup = fakeNotifier();
    await sendDigests({ db: b.db, notifier: toGroup, now: () => nsk("2026-10-18T20:00") });
    expect(toGroup.groups.map((g) => g.chatId)).toEqual([-900]);
    expect(toGroup.dms).toEqual([]);
  });
});

describe("friends in the daily reminder", () => {
  it("mentions the most active friend today", async () => {
    const { db, alice, bob } = await setup();
    await review(db, bob.id, 2, nsk("2026-10-16T19:00"));
    const notifier = fakeNotifier();
    await sendReminders({ db, notifier, now: () => nsk("2026-10-16T20:00") });
    const toAlice = notifier.dms.find((d) => d.to === "Alice")!;
    expect(toAlice.text).toContain("Bob сегодня уже повторил(а) 2");
    expect(notifier.dms.find((d) => d.to === "Bob")!.text).not.toContain("сегодня уже");
    void alice;
  });

  it("formats the reminder with and without a friend", () => {
    expect(reminderText(3)).toBe("🔔 3 слова ждут повторения");
    expect(reminderText(1, { name: "R&D", reviews: 21 })).toBe("🔔 1 слово ждёт повторения · R&amp;D сегодня уже повторил(а) 21 🔥");
  });
});
