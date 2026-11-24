import { describe, expect, it } from "vitest";
import { cards, words } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { findWord, MAX_TERM, normalizeTerm, parseAddInput, saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

const draft = { term: "Bank", translation: "берег", explanation: "", example: "" };

describe("parseAddInput", () => {
  it("parses term with optional translation", () => {
    expect(parseAddInput("serendipity")).toEqual({ term: "serendipity" });
    expect(parseAddInput(" bank — берег реки ")).toEqual({ term: "bank", translation: "берег реки" });
    expect(parseAddInput("bank - берег")).toEqual({ term: "bank", translation: "берег" });
    expect(parseAddInput("well-known")).toEqual({ term: "well-known" });
    expect(parseAddInput("   ")).toBeNull();
    expect(parseAddInput(" — берег")).toBeNull();
  });

  it("normalizes case and spaces", () => {
    expect(normalizeTerm("  Bank   Account ")).toBe("bank account");
  });
});

describe("saveWord", () => {
  it("creates a card for every member including the author", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });

    const result = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft, now: T0 });
    if (result.status !== "saved") throw new Error("expected saved");
    expect(result.word).toMatchObject({ term: "Bank", termNormalized: "bank", translation: "берег" });
    expect(result.members).toHaveLength(2);
    expect(await db.select().from(cards)).toHaveLength(2);
  });

  it("отказывает слову длиннее предела — иначе оно вешает виджет и не влезает в карточку", async () => {
    // Раньше длину не проверял никто: ни /add, ни prepareWord, ни saveWord — только расширение
    // и Mini App. Слово в 1100 символов проходило в базу, создавало карточки всем участникам
    // и роняло /learnnew в вечный цикл.
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });

    const long = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { ...draft, term: "x".repeat(MAX_TERM + 1) }, now: T0 });
    expect(long).toEqual({ status: "too-long", limit: MAX_TERM });
    expect(await db.select().from(words)).toHaveLength(0);

    // На самом пределе — проходит: граница не должна быть на единицу меньше обещанного.
    const edge = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { ...draft, term: "y".repeat(MAX_TERM) }, now: T0 });
    expect(edge.status).toBe("saved");
  });

  it("rejects duplicates regardless of case and spaces", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft, now: T0 });
    const again = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { ...draft, term: " bank " }, now: T0 });
    expect(again).toEqual({ status: "duplicate" });
    expect(await findWord(db, room.id, "BANK")).toMatchObject({ term: "Bank" });
  });
});
