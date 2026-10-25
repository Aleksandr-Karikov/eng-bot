import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, clozeSentences, duelPoints, reviewLogs, roomMembers, rooms, users, words, type Room, type User, wordUses, stories } from "../db/schema";
import { LANGUAGES, type LangCode } from "../lang";
import { createCards } from "./cards";
import { getUser, parseLastRooms, updateUser } from "./users";

export async function createRoom(
  db: Db,
  input: { name: string; createdBy: number; now: Date; telegramChatId?: number; personal?: boolean; language?: LangCode },
): Promise<Room> {
  const language = input.language ?? "en";
  const [room] = await db
    .insert(rooms)
    .values({
      name: input.name,
      inviteCode: randomBytes(6).toString("base64url"),
      telegramChatId: input.telegramChatId ?? null,
      language,
      personalOf: input.personal ? input.createdBy : null,
      // Английский личный словарь отмечаем и по-старому — чтобы код до появления языков (при откате) его видел.
      legacyPersonalOf: input.personal && language === "en" ? input.createdBy : null,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .returning();
  // Личный словарь становится текущим, только если другой комнаты ещё нет — общую с друзьями он не вытесняет.
  // Комната группы (создана из группы через /link) — тоже: в личке человек остаётся там, где был.
  await joinRoom(db, { roomId: room.id, userId: input.createdBy, now: input.now, makeCurrent: !input.personal && input.telegramChatId == null });
  return room;
}

export const PERSONAL_ROOM_NAME = "Мои слова";

/** «Мои слова» — английский, как было; для других языков с флагом: «Мои слова 🇰🇷». */
export function personalRoomName(language: LangCode = "en"): string {
  return language === "en" ? PERSONAL_ROOM_NAME : `${PERSONAL_ROOM_NAME} ${LANGUAGES[language].flag}`;
}

export async function personalRoom(db: Db, userId: number, language: LangCode = "en"): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(and(eq(rooms.personalOf, userId), eq(rooms.language, language)));
  return room;
}

/**
 * Личный словарь «Мои слова»: есть у каждого, создаётся сам — одиночке не нужно разбираться с комнатами,
 * а слова из готовых наборов идут сюда, а не в общую комнату с друзьями.
 */
export async function ensurePersonalRoom(db: Db, userId: number, now: Date, language: LangCode = "en"): Promise<Room> {
  return (
    (await personalRoom(db, userId, language)) ??
    createRoom(db, { name: personalRoomName(language), createdBy: userId, now, personal: true, language })
  );
}

/**
 * Куда вернуть человека, когда он переключается на язык (/lang): в последнюю комнату этого языка, где он был;
 * нет такой — в общую комнату этого языка; нет и её — в личный словарь (created — его только что завели).
 */
export async function roomForLanguage(db: Db, user: User, language: LangCode, now: Date): Promise<{ room: Room; created: boolean }> {
  const mine = (await listUserRooms(db, user.id)).filter((r) => r.language === language);
  const last = parseLastRooms(user.lastRooms)[language];
  const room = mine.find((r) => r.id === last) ?? mine.find((r) => r.personalOf == null) ?? mine.find((r) => r.personalOf === user.id);
  if (room) return { room, created: false };
  return { room: await ensurePersonalRoom(db, user.id, now, language), created: true };
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

/** Отвязать группу от её комнаты (комната со словами остаётся). */
export async function unlinkGroup(db: Db, chatId: number): Promise<void> {
  await db.update(rooms).set({ telegramChatId: null }).where(eq(rooms.telegramChatId, chatId));
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
