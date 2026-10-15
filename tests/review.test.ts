import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { reviewLogs } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard, countDue, markKnown, nextDue, nextReviewAt } from "../src/services/review";
import { saveWord } from "../src/services/words";
import { DAY, MIN, T0, at, makeUser, testDb } from "./helpers";

async function setup() {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const bob = await makeUser(db, 2);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
  const add = async (term: string, now = T0) => {
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now });
    if (r.status !== "saved") throw new Error("dup");
    return r.word;
  };
  return { db, alice, bob, room, add };
}

describe("review", () => {
  it("serves due reviews before new cards, new cards oldest first", async () => {
    const { db, bob, add } = await setup();
    await add("first", T0);
    await add("second", at(MIN));
    const old = await add("old", T0);
    expect((await nextDue(db, bob.id, at(2 * MIN)))!.word.term).toBe("first");
    // "old" отвечаем Easy → становится Review; через 30 дней она просрочена и должна идти первой.
    await markKnown(db, { userId: bob.id, wordId: old.id, now: T0 });
    const later = at(30 * DAY);
    expect((await nextDue(db, bob.id, later))!.word.term).toBe("old");
    expect(await countDue(db, bob.id, later)).toBe(3);
  });

  it("answers a card, logs it and rejects stale presses", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("ok");
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("does not let a user answer someone else's card", async () => {
    const { db, alice, bob, add } = await setup();
    await add("word");
    const bobsCard = (await nextDue(db, bob.id, T0))!.card;
    expect(await answerCard(db, { userId: alice.id, cardId: bobsCard.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
  });

  it("markKnown pushes a new card far ahead and works once", async () => {
    const { db, bob, add } = await setup();
    const word = await add("word");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("ok");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("stale");
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const next = await nextReviewAt(db, bob.id);
    expect(next!.getTime() - T0.getTime()).toBeGreaterThanOrEqual(4 * DAY);
  });

  it("learns ahead: a just-failed card comes back in the same session", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "again", now: T0 });
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const again = await nextDue(db, bob.id, T0);
    expect(again?.card.id).toBe(item.card.id);
    expect(again?.card.state).not.toBe(State.New);
  });
});
