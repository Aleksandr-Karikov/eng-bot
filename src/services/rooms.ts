import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { roomMembers, rooms, users, words, type Room, type User } from "../db/schema";
import { createCards } from "./cards";
import { getUser, updateUser } from "./users";

export async function createRoom(
  db: Db,
  input: { name: string; createdBy: number; now: Date; telegramChatId?: number },
): Promise<Room> {
  const [room] = await db
    .insert(rooms)
    .values({
      name: input.name,
      inviteCode: randomBytes(6).toString("base64url"),
      telegramChatId: input.telegramChatId ?? null,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .returning();
  await joinRoom(db, { roomId: room.id, userId: input.createdBy, now: input.now, makeCurrent: true });
  return room;
}

export async function isMember(db: Db, roomId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  return rows.length > 0;
}

export async function joinRoom(
  db: Db,
  input: { roomId: number; userId: number; now: Date; makeCurrent: boolean },
): Promise<boolean> {
  const alreadyMember = await isMember(db, input.roomId, input.userId);
  if (!alreadyMember) {
    await db.insert(roomMembers).values({ roomId: input.roomId, userId: input.userId, joinedAt: input.now });
    const roomWords = await db.select({ id: words.id }).from(words).where(eq(words.roomId, input.roomId));
    await createCards(db, [input.userId], roomWords.map((w) => w.id), input.now);
  }
  const user = await getUser(db, input.userId);
  if (input.makeCurrent || user?.currentRoomId == null) {
    await updateUser(db, input.userId, { currentRoomId: input.roomId });
  }
  return !alreadyMember;
}

export async function getRoom(db: Db, id: number): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
  return room;
}

export async function findRoomByInvite(db: Db, code: string): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.inviteCode, code));
  return room;
}

export async function findRoomByChat(db: Db, chatId: number): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.telegramChatId, chatId));
  return room;
}

export async function listUserRooms(db: Db, userId: number): Promise<Room[]> {
  const rows = await db
    .select({ room: rooms })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(eq(roomMembers.userId, userId));
  return rows.map((r) => r.room);
}

export async function listMembers(db: Db, roomId: number): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(roomMembers)
    .innerJoin(users, eq(roomMembers.userId, users.id))
    .where(eq(roomMembers.roomId, roomId));
  return rows.map((r) => r.user);
}

export async function linkGroup(
  db: Db,
  roomId: number,
  chatId: number,
): Promise<"linked" | "chat_taken" | "room_has_group"> {
  if (await findRoomByChat(db, chatId)) return "chat_taken";
  const room = await getRoom(db, roomId);
  if (room?.telegramChatId != null) return "room_has_group";
  await db.update(rooms).set({ telegramChatId: chatId }).where(eq(rooms.id, roomId));
  return "linked";
}
