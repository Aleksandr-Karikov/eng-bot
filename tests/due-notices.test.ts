import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import type { User } from "../src/db/schema";
import { sendDueNotices, sendReminders } from "../src/reminder-loop";
import { answerCard } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { makeUser, testDb } from "./helpers";

const nsk = (iso: string) => new Date(`${iso}+07:00`);
const H = 60 * 60_000;

async function setup(dueWords: number) {
  const db = testDb();
  const alice = await updateUser(db, (await makeUser(db, 1, "Alice")).id, { canDm: true });
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: nsk("2026-10-17T09:00") });
  for (let i = 0; i < dueWords; i++) {
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: `w${i}`, translation: "t", explanation: "", example: "" }, now: nsk("2026-10-17T09:00") });
  }
  return { db, alice };
}

function notifier() {
  const sent: string[] = [];
  return { sent, dm: async (_u: User, text: string) => (sent.push(text), true) };
}

describe("«words are back» notices", () => {
  it("notifies once at least 5 words are due, then not again for 3 hours", async () => {
    const { db } = await setup(5);
    const n = notifier();
    const run = (at: Date) => sendDueNotices({ db, notifier: n, now: () => at });
    expect(await run(nsk("2026-10-18T12:00"))).toBe(1);
    expect(n.sent[0]).toContain("5 слов");
    expect(await run(nsk("2026-10-18T14:59"))).toBe(0);
    expect(await run(nsk("2026-10-18T15:01"))).toBe(1);
  });

  it("stays quiet with fewer than 5 words, at night, or right after studying", async () => {
    const few = await setup(4);
    expect(await sendDueNotices({ db: few.db, notifier: notifier(), now: () => nsk("2026-10-18T12:00") })).toBe(0);

    const night = await setup(5);
    expect(await sendDueNotices({ db: night.db, notifier: notifier(), now: () => nsk("2026-10-18T23:00") })).toBe(0);
    expect(await sendDueNotices({ db: night.db, notifier: notifier(), now: () => nsk("2026-10-18T08:59") })).toBe(0);

    const busy = await setup(6);
    const [card] = await busy.db.select().from(cards).where(eq(cards.userId, busy.alice.id));
    await answerCard(busy.db, { userId: busy.alice.id, cardId: card.id, expectedReps: 0, answer: "good", now: nsk("2026-10-18T11:30") });
    expect(await sendDueNotices({ db: busy.db, notifier: notifier(), now: () => nsk("2026-10-18T12:00") })).toBe(0);
  });

  it("respects the switch in settings", async () => {
    const { db, alice } = await setup(5);
    await updateUser(db, alice.id, { notifyDue: false });
    expect(await sendDueNotices({ db, notifier: notifier(), now: () => nsk("2026-10-18T12:00") })).toBe(0);
  });

  it("the daily reminder counts as a notice, so they don't come back to back", async () => {
    const { db, alice } = await setup(5);
    const n = notifier();
    await sendReminders({ db, notifier: n, now: () => nsk("2026-10-18T20:00") });
    expect((await getUser(db, alice.id))?.lastDueNoticeAt?.getTime()).toBe(nsk("2026-10-18T20:00").getTime());
    expect(await sendDueNotices({ db, notifier: n, now: () => nsk("2026-10-18T21:00") })).toBe(0);
    void H;
  });
});
