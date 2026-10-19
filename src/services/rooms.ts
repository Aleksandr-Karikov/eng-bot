import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, clozeSentences, duelPoints, reviewLogs, roomMembers, rooms, users, words, type Room, type User, wordUses, stories } from "../db/schema";
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

/**
 * Удаляет комнату целиком: слова, карточки и историю повторений всех участников, предложения с пропуском.
 * У кого она была текущей — переключает на другую их комнату (или ни на какую).
 */
export async function deleteRoom(db: Db, roomId: number): Promise<void> {
  const wordIds = (await db.select({ id: words.id }).from(words).where(eq(words.roomId, roomId))).map((w) => w.id);
  if (wordIds.length) {
    const cardIds = (await db.select({ id: cards.id }).from(cards).where(inArray(cards.wordId, wordIds))).map((c) => c.id);
    if (cardIds.length) await db.delete(reviewLogs).where(inArray(reviewLogs.cardId, cardIds));
    await db.delete(clozeSentences).where(inArray(clozeSentences.wordId, wordIds));
    await db.delete(wordUses).where(eq(wordUses.roomId, roomId));
    await db.delete(cards).where(inArray(cards.wordId, wordIds));
    await db.delete(words).where(eq(words.roomId, roomId));
  }
  const members = await listMembers(db, roomId);
  await db.delete(duelPoints).where(eq(duelPoints.roomId, roomId));
  await db.delete(stories).where(eq(stories.roomId, roomId));
  await db.delete(roomMembers).where(eq(roomMembers.roomId, roomId));
  await db.delete(rooms).where(eq(rooms.id, roomId));
  for (const member of members) {
    if (member.currentRoomId !== roomId) continue;
    const [other] = await listUserRooms(db, member.id);
    await updateUser(db, member.id, { currentRoomId: other?.id ?? null });
  }
}

export async function renameRoom(db: Db, roomId: number, name: string): Promise<void> {
  await db.update(rooms).set({ name }).where(eq(rooms.id, roomId));
}
