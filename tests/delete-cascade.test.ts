import { describe, expect, it } from "vitest";
import { cards, clozeSentences, duelPoints, reviewLogs, stories, wordUses, words, rooms } from "../src/db/schema";
import { createRoom, deleteRoom } from "../src/services/rooms";
import { deleteWord, saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

/** Слово со всем, что на него ссылается: повторения, предложения, 👏 в чате, история, очки дуэли. */
async function fullRoom() {
  const db = testDb();
  const user = await makeUser(db, 100);
  const room = await createRoom(db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  if (saved.status !== "saved") throw new Error("not saved");
  const [card] = await db.select().from(cards);
  await db.insert(reviewLogs).values({ userId: user.id, cardId: card.id, rating: "good", reviewedAt: T0 });
  await db.insert(clozeSentences).values({ wordId: saved.word.id, sentence: "A ___.", answer: "bank", translation: "", createdAt: T0 });
  await db.insert(wordUses).values({ roomId: room.id, userId: user.id, wordId: saved.word.id, createdAt: T0 });
  await db.insert(stories).values({ roomId: room.id, title: "t", body: "b", glossary: "[]", questions: "[]", createdAt: T0 });
  await db.insert(duelPoints).values({ roomId: room.id, userId: user.id, createdAt: T0 });
  return { db, room, word: saved.word };
}

describe("deleting cleans up everything that refers to it", () => {
  it("a word used in chat (👏) is deleted completely", async () => {
    const { db, word } = await fullRoom();
    await deleteWord(db, word.id);
    expect(await db.select().from(words)).toEqual([]);
    expect(await db.select().from(cards)).toEqual([]);
    expect(await db.select().from(wordUses)).toEqual([]);
  });

  it("a room with words, stories and duel points is deleted completely", async () => {
    const { db, room } = await fullRoom();
    await deleteRoom(db, room.id);
    expect(await db.select().from(rooms)).toEqual([]);
    expect(await db.select().from(words)).toEqual([]);
    expect(await db.select().from(stories)).toEqual([]);
    expect(await db.select().from(wordUses)).toEqual([]);
  });
});
