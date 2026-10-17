import { describe, expect, it, vi } from "vitest";
import { cards, clozeSentences, reviewLogs, roomMembers, rooms, words } from "../src/db/schema";
import { saveCloze } from "../src/services/cloze";
import { answerCard, nextDue } from "../src/services/review";
import { createRoom, deleteRoom, joinRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

describe("deleteRoom", () => {
  it("removes the room with its words, cards, history and sentences, and moves members to another room", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    const keep = await createRoom(db, { name: "Keep", createdBy: alice.id, now: T0 });
    const gone = await createRoom(db, { name: "Gone", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: gone.id, userId: bob.id, now: T0, makeCurrent: true });
    const kept = await saveWord(db, { roomId: keep.id, addedBy: alice.id, draft: { term: "keep", translation: "t", explanation: "", example: "" }, now: T0 });
    const w = await saveWord(db, { roomId: gone.id, addedBy: alice.id, draft: { term: "gone", translation: "t", explanation: "", example: "" }, now: T0 });
    if (w.status !== "saved" || kept.status !== "saved") throw new Error("dup");
    await saveCloze(db, w.word.id, [{ sentence: "a ___", answer: "gone", translation: "" }], T0);
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 });

    await deleteRoom(db, gone.id);
    expect((await db.select().from(rooms)).map((r) => r.name)).toEqual(["Keep"]);
    expect((await db.select().from(words)).map((x) => x.term)).toEqual(["keep"]);
    expect(await db.select().from(cards)).toHaveLength(1);
    expect(await db.select().from(reviewLogs)).toHaveLength(0);
    expect(await db.select().from(clozeSentences)).toHaveLength(0);
    expect((await db.select().from(roomMembers)).map((m) => m.userId)).toEqual([alice.id]);
    expect((await getUser(db, alice.id))?.currentRoomId).toBe(keep.id);
    expect((await getUser(db, bob.id))?.currentRoomId).toBeNull();
  });
});

describe("/room management", () => {
  it("lets the creator delete the current room after confirming", async () => {
    const h = botHarness();
    const alice = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "Keep", createdBy: alice.id, now: T0 });
    await createRoom(h.db, { name: "Test", createdBy: alice.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/room"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Удалить комнату")));
    expect(h.calls.some((c) => String(c.payload.text).includes("«Test»"))).toBe(true);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Да, удалить")));
    expect((await h.db.select().from(rooms)).map((r) => r.name)).toEqual(["Keep"]);
  });

  it("does not offer or allow deletion to non-creators", async () => {
    const h = botHarness();
    const alice = await makeUser(h.db, 100);
    const bob = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "Shared", createdBy: alice.id, now: T0 });
    await joinRoom(h.db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    await h.bot.handleUpdate(h.message(200, "/room"));
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🗑 Удалить комнату");
    await h.bot.handleUpdate(h.callback(200, `rxo:${room.id}`));
    expect(await h.db.select().from(rooms)).toHaveLength(1);
  });

  it("asks for a name when creating a room, and the reply does not become a word", async () => {
    const enrich = vi.fn(async () => ({ translation: "x", explanation: "", example: "" }));
    const h = botHarness({ enricher: { enrich, extract: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) } });
    await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/room"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Новая комната")));
    expect(h.calls.some((c) => String(c.payload.text).includes("Как назвать"))).toBe(true);
    await h.bot.handleUpdate(h.message(100, "English club"));
    await vi.waitFor(async () => expect((await h.db.select().from(rooms)).map((r) => r.name)).toEqual(["English club"]));
    expect(enrich).not.toHaveBeenCalled();

    await h.bot.handleUpdate(h.message(100, "/newroom"));
    expect(h.calls.filter((c) => String(c.payload.text).includes("Как назвать"))).toHaveLength(2);
    await h.bot.handleUpdate(h.message(100, "/newroom Друзья"));
    expect((await h.db.select().from(rooms)).map((r) => r.name)).toContain("Друзья");
  });
});
