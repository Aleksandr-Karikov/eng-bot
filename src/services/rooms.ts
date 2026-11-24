import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, clozeSentences, duelPoints, reviewLogs, roomMembers, rooms, users, words, type Room, type User, wordUses, stories } from "../db/schema";
import { createCards } from "./cards";
import { ROOM_LIMITS, ROOM_REFUSALS } from "./limits";
import { getUser, parseLastRooms, updateUser } from "./users";
import { removeReviewHistory } from "./combat-ledger";
import { isTimeZone } from "../time";

export async function createRoom(
  db: Db,
  input: { name: string; createdBy: number; now: Date; telegramChatId?: number; personal?: boolean },
): Promise<Room> {
  // Пояс комнаты — пояс автора на момент создания: по нему считаются границы недели и слово дня.
  const author = await getUser(db, input.createdBy);
  const [room] = await db
    .insert(rooms)
    .values({
      name: input.name,
      inviteCode: randomBytes(6).toString("base64url"),
      telegramChatId: input.telegramChatId ?? null,
      ...(author?.timezone ? { timezone: author.timezone } : {}),
      personalOf: input.personal ? input.createdBy : null,
      // Прежняя отметка личного словаря — чтобы код до появления языков (при откате) его видел.
      legacyPersonalOf: input.personal ? input.createdBy : null,
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

/** Название личного словаря. Одно на человека: язык у бота теперь только английский (E23). */
export function personalRoomName(): string {
  return PERSONAL_ROOM_NAME;
}

export async function personalRoom(db: Db, userId: number): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.personalOf, userId));
  return room;
}

/**
 * Личный словарь «Мои слова»: есть у каждого, создаётся сам — одиночке не нужно разбираться с комнатами,
 * а слова из готовых наборов идут сюда, а не в общую комнату с друзьями.
 */
export async function ensurePersonalRoom(db: Db, userId: number, now: Date): Promise<Room> {
  return (
    (await personalRoom(db, userId)) ??
    createRoom(db, { name: personalRoomName(), createdBy: userId, now, personal: true })
  );
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

/**
 * Можно ли этому человеку завести ещё одну комнату — и почему нет.
 *
 * Личные словари не считаются: их заводит сам бот (`ensurePersonalRoom`) при первом заходе и при смене
 * языка, и человек об этом не просит. Иначе лимит «3 комнаты» съедался бы английским и корейским
 * словарями, и на друзей места не осталось бы.
 *
 * `isAdmin` снимает лимит: админ заводит комнаты для проверки и для чужих наборов, и упираться в потолок
 * ему не за чем. Флаг приходит от обработчика (`deps.adminTelegramId`), а не сравнивается здесь с
 * `users.telegramId`: сервис не должен знать про настройки бота.
 */
export async function roomCreationAllowed(
  db: Db,
  userId: number,
  opts: { isAdmin?: boolean } = {},
): Promise<{ allowed: true } | { allowed: false; refusal: string }> {
  if (opts.isAdmin) return { allowed: true };
  const created = (await listUserRooms(db, userId)).filter((r) => r.personalOf == null && r.createdBy === userId).length;
  if (created >= ROOM_LIMITS.created) return { allowed: false, refusal: ROOM_REFUSALS.created(created) };
  return { allowed: true };
}

/**
 * Можно ли этому человеку войти в комнату: не переполнена и у него самого есть место.
 *
 * Уже состоящий в комнате проходит всегда — иначе человек, добравшийся до лимита, не смог бы даже
 * вернуться в свою же комнату по старой ссылке и решил бы, что его выгнали.
 *
 * `isAdmin` снимает оба потолка. Лимит участий — это про «хватит собирать чужие комнаты», и админа он
 * только мешает: разбираясь с чужой комнатой, он должен в неё попасть. Потолок комнаты снят за ту же
 * цену: она не резиновая, но 50 — это защита от наплыва, а не от админа.
 */
export async function joinAllowed(
  db: Db,
  input: { roomId: number; userId: number; isAdmin?: boolean },
): Promise<{ allowed: true } | { allowed: false; refusal: string }> {
  if (await isMember(db, input.roomId, input.userId)) return { allowed: true };
  if (input.isAdmin) return { allowed: true };
  if ((await memberCount(db, input.roomId)) >= ROOM_LIMITS.members) return { allowed: false, refusal: ROOM_REFUSALS.full };
  if ((await listUserRooms(db, input.userId)).length >= ROOM_LIMITS.joined) {
    return { allowed: false, refusal: ROOM_REFUSALS.joined };
  }
  return { allowed: true };
}

/** Сколько людей в комнате. Отдельным запросом, а не `listMembers`: нужен только счёт. */
export async function memberCount(db: Db, roomId: number): Promise<number> {
  const rows = await db.select({ userId: roomMembers.userId }).from(roomMembers).where(eq(roomMembers.roomId, roomId));
  return rows.length;
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
    if (cardIds.length) await removeReviewHistory(db, inArray(reviewLogs.cardId, cardIds));
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

/**
 * Сменить пояс комнаты. Меняет границу недели — босс, цель, монеты, трофеи и слово дня переедут вместе с ней.
 *
 * Пояс проверяется: неизвестное значение сделало бы неделю невычислимой. Вызывать только для владельца
 * комнаты — это решение, затрагивающее всех участников.
 */
export async function updateRoomTimezone(db: Db, roomId: number, timeZone: string): Promise<boolean> {
  if (!isTimeZone(timeZone)) return false;
  await db.update(rooms).set({ timezone: timeZone }).where(eq(rooms.id, roomId));
  return true;
}
