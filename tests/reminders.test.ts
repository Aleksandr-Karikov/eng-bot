import { describe, expect, it } from "vitest";
import type { User } from "../src/db/schema";
import { sendReminders } from "../src/reminder-loop";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

// Новосибирск = UTC+7 — пояс пользователей по умолчанию.
const nsk = (iso: string) => new Date(`${iso}+07:00`);

/** Фейковая доставка: по умолчанию успешна, outcomes переопределяет результаты по порядку. */
function fakeNotifier(outcomes: Array<boolean | Error> = []) {
  const delivered: string[] = [];
  return {
    delivered,
    dm: async (user: User, text: string) => {
      const outcome = outcomes.shift() ?? true;
      if (outcome instanceof Error) throw outcome;
      if (outcome) delivered.push(`${user.telegramId}: ${text}`);
      return outcome;
    },
  };
}

async function setup(withWord = true) {
  const db = testDb();
  const alice = await makeUser(db, 1);
  await updateUser(db, alice.id, { canDm: true });
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  if (withWord) {
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "a", translation: "t", explanation: "", example: "" }, now: T0 });
  }
  return { db, alice };
}

describe("sendReminders", () => {
  it("fires once per local day at or after reminder time", async () => {
    const { db } = await setup();
    const notifier = fakeNotifier();
    const run = (iso: string) => sendReminders({ db, notifier, now: () => nsk(iso) });
    expect(await run("2026-10-15T19:59")).toBe(0);
    expect(await run("2026-10-15T20:00")).toBe(1);
    expect(notifier.delivered).toEqual(["1: 🔔 1 слово ждёт повторения"]);
    expect(await run("2026-10-15T20:30")).toBe(0);
    expect(await run("2026-10-16T20:05")).toBe(1);
  });

  it("catches up after downtime later the same evening", async () => {
    const { db } = await setup();
    expect(await sendReminders({ db, notifier: fakeNotifier(), now: () => nsk("2026-10-15T23:40") })).toBe(1);
  });

  it("skips users who cannot receive DMs", async () => {
    const { db, alice } = await setup();
    await updateUser(db, alice.id, { canDm: false });
    expect(await sendReminders({ db, notifier: fakeNotifier(), now: () => nsk("2026-10-15T20:00") })).toBe(0);
  });

  it("stays silent with nothing due", async () => {
    const { db } = await setup(false);
    const notifier = fakeNotifier();
    expect(await sendReminders({ db, notifier, now: () => nsk("2026-10-15T20:00") })).toBe(0);
    expect(notifier.delivered).toEqual([]);
  });

  it("retries on the next tick when delivery failed (network down right after wake)", async () => {
    const { db } = await setup();
    const notifier = fakeNotifier([false, new Error("ETIMEDOUT")]);
    const run = (iso: string) => sendReminders({ db, notifier, now: () => nsk(iso) });
    expect(await run("2026-10-15T20:00")).toBe(0);
    expect(await run("2026-10-15T20:01")).toBe(0);
    expect(await run("2026-10-15T20:02")).toBe(1);
    expect(await run("2026-10-15T20:03")).toBe(0);
  });
});
