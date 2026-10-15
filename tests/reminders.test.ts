import { describe, expect, it } from "vitest";
import { createRoom } from "../src/services/rooms";
import { collectReminders } from "../src/services/reminders";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

// Москва = UTC+3.
const msk = (iso: string) => new Date(`${iso}+03:00`);

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

describe("collectReminders", () => {
  it("fires once per local day at or after reminder time", async () => {
    const { db } = await setup();
    expect(await collectReminders(db, msk("2026-10-15T19:59"))).toHaveLength(0);
    const fired = await collectReminders(db, msk("2026-10-15T20:00"));
    expect(fired).toHaveLength(1);
    expect(fired[0].dueCount).toBe(1);
    expect(await collectReminders(db, msk("2026-10-15T20:30"))).toHaveLength(0);
    expect(await collectReminders(db, msk("2026-10-16T20:05"))).toHaveLength(1);
  });

  it("catches up after downtime later the same evening", async () => {
    const { db } = await setup();
    expect(await collectReminders(db, msk("2026-10-15T23:40"))).toHaveLength(1);
  });

  it("skips users who cannot receive DMs", async () => {
    const { db, alice } = await setup();
    await updateUser(db, alice.id, { canDm: false });
    expect(await collectReminders(db, msk("2026-10-15T20:00"))).toHaveLength(0);
  });

  it("stays silent with nothing due and does not retry the same day", async () => {
    const { db } = await setup(false);
    expect(await collectReminders(db, msk("2026-10-15T20:00"))).toHaveLength(0);
    expect(await collectReminders(db, msk("2026-10-15T21:00"))).toHaveLength(0);
  });
});
