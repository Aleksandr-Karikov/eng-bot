import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard, nextDue } from "../src/services/review";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { MIN, T0, at, makeUser, testDb } from "./helpers";

const draft = (term: string) => ({ term, translation: `t-${term}`, explanation: "old", example: "old example" });

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
  return { db, bob, add };
}

describe("updateWord", () => {
  it("changes the translation and keeps everyone's progress", async () => {
    const { db, bob, add } = await setup();
    const bank = await add("bank");
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 });

    const res = await updateWord(db, bank.id, { translation: "берег", explanation: "new", example: "new example" });
    expect(res).toMatchObject({ status: "updated", word: { term: "bank", translation: "берег", explanation: "new" } });
    const [bobCard] = await db.select().from(cards).where(eq(cards.id, item.card.id));
    expect(bobCard.reps).toBe(1);
  });

  it("renames the term and refuses a rename onto another word of the room", async () => {
    const { db, add } = await setup();
    const bank = await add("bank");
    const hangar = await add("hangar", at(MIN));
    expect(await updateWord(db, bank.id, { term: "Banc", translation: "x", explanation: "", example: "" })).toMatchObject({
      status: "updated",
      word: { term: "Banc", termNormalized: "banc" },
    });
    expect(await updateWord(db, hangar.id, { term: " BANC ", translation: "y", explanation: "", example: "" })).toEqual({ status: "duplicate" });
    expect((await getWord(db, hangar.id))?.translation).toBe("t-hangar");
    expect(await updateWord(db, hangar.id, { term: "Hangar", translation: "ангар", explanation: "", example: "" })).toMatchObject({ status: "updated" });
  });
});
