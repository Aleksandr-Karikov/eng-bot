import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import {
  createRoom, findRoomByChat, findRoomByInvite, isMember, joinRoom, linkGroup, listMembers, listUserRooms,
} from "../src/services/rooms";
import { getUser } from "../src/services/users";
import { T0, makeUser, testDb } from "./helpers";

async function addRawWord(db: ReturnType<typeof testDb>, roomId: number, addedBy: number, term: string) {
  const [w] = await db
    .insert(words)
    .values({ roomId, addedBy, term, termNormalized: term, translation: "t", createdAt: T0 })
    .returning();
  return w;
}

describe("rooms", () => {
  it("creator becomes a member and the room becomes current", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "Друзья", createdBy: alice.id, now: T0 });
    expect(room.inviteCode.length).toBeGreaterThanOrEqual(8);
    expect(await isMember(db, room.id, alice.id)).toBe(true);
    expect((await getUser(db, alice.id))?.currentRoomId).toBe(room.id);
    expect(await findRoomByInvite(db, room.inviteCode)).toMatchObject({ id: room.id });
  });

  it("joining creates cards for existing words, only once", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await addRawWord(db, room.id, alice.id, "a");
    await addRawWord(db, room.id, alice.id, "b");

    expect(await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true })).toBe(true);
    expect(await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true })).toBe(false);
    expect(await db.select().from(cards).where(eq(cards.userId, bob.id))).toHaveLength(2);
    expect((await listMembers(db, room.id)).map((u) => u.id).sort()).toEqual([alice.id, bob.id]);
  });

  it("makeCurrent=false keeps an existing current room", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const first = await createRoom(db, { name: "1", createdBy: alice.id, now: T0 });
    const bob = await makeUser(db, 2);
    const second = await createRoom(db, { name: "2", createdBy: bob.id, now: T0 });
    await joinRoom(db, { roomId: second.id, userId: alice.id, now: T0, makeCurrent: false });
    expect((await getUser(db, alice.id))?.currentRoomId).toBe(first.id);
    expect((await listUserRooms(db, alice.id)).map((r) => r.id).sort()).toEqual([first.id, second.id]);
  });

  it("links a group once", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const r1 = await createRoom(db, { name: "1", createdBy: alice.id, now: T0 });
    const r2 = await createRoom(db, { name: "2", createdBy: alice.id, now: T0 });
    expect(await linkGroup(db, r1.id, -100)).toBe("linked");
    expect(await findRoomByChat(db, -100)).toMatchObject({ id: r1.id });
    expect(await linkGroup(db, r2.id, -100)).toBe("chat_taken");
    expect(await linkGroup(db, r1.id, -200)).toBe("room_has_group");
  });
});
