import { describe, expect, it } from "vitest";
import { cards, reviewLogs, words } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard, nextDue } from "../src/services/review";
import { deleteWord, listRoomWords, saveWord } from "../src/services/words";
import { MIN, T0, at, makeUser, testDb } from "./helpers";

const draft = (term: string) => ({ term, translation: `t-${term}`, explanation: "", example: "" });

async function setup() {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const bob = await makeUser(db, 2);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
  const add = async (term: string, now = T0) => {
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: draft(term), now });
    if (r.status !== "saved") throw new Error("dup");
    return r.word;
  };
  return { db, alice, bob, room, add };
}

describe("deleteWord", () => {
  it("removes the word with everyone's cards and review history, leaving other words intact", async () => {
    const { db, bob, add } = await setup();
    const bank = await add("bank");
    await add("hangar", at(MIN));
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 });

    expect(await deleteWord(db, bank.id)).toMatchObject({ term: "bank" });
    expect((await db.select().from(words)).map((w) => w.term)).toEqual(["hangar"]);
    expect(await db.select().from(cards)).toHaveLength(2);
    expect(await db.select().from(reviewLogs)).toHaveLength(0);
    expect(await deleteWord(db, bank.id)).toBeUndefined();
  });
});

describe("listRoomWords", () => {
  it("lists newest first and filters by a case-insensitive fragment", async () => {
    const { db, room, add } = await setup();
    await add("bank", T0);
    await add("his arse is drowning in the butter", at(MIN));
    await add("Butterfly", at(2 * MIN));
    expect((await listRoomWords(db, room.id)).map((w) => w.term)).toEqual(["Butterfly", "his arse is drowning in the butter", "bank"]);
    expect((await listRoomWords(db, room.id, "  BUTTER ")).map((w) => w.term)).toEqual(["Butterfly", "his arse is drowning in the butter"]);
  });
});
