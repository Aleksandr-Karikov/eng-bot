import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms, users, type User } from "../db/schema";
import { isTimeZone } from "../time";
import { withCombatLock } from "./combat-ledger";

/** Пояс новых пользователей. В схеме default остался Europe/Moscow: менять его в SQLite — пересоздавать таблицу. */
export const DEFAULT_TIMEZONE = "Asia/Novosibirsk";
export const MAX_LEARNING_LIMIT = 1000;
export const DEFAULT_NEW_PER_DAY = 15;
export const DEFAULT_ACTIVE_LEARNING_LIMIT = 15;
export const ACTIVE_LEARNING_CHOICES = [10, 15, 20, 30];

export function setNewPerDay(db: Db, userId: number, limit: number) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_LEARNING_LIMIT) return;
  return updateUser(db, userId, { newPerDay: limit });
}

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
}

export type UserPatch = Partial<
  Pick<
    User,
    "canDm" | "reminderTime" | "currentRoomId" | "lastReminderDate" | "groupHintSent" | "modeEnRu" | "modeRuEn" | "modeCloze" | "modeSentence" | "modeListen" | "modeCollocation" | "modeDrill" | "modeBoss" | "cardHidden" | "voiceAccent" | "notifyDue" | "weeklyReport" | "captureKey" | "explainLimit" | "lastReportDate" | "lastDueNoticeAt" | "timezone" | "timezoneFromDevice" | "setTargetRoomId" | "newPerDay" | "activeLearningLimit"
  >
>;

export async function upsertUser(db: Db, tg: TgUser, now: Date): Promise<User> {
  const username = tg.username ?? null;
  const [existing] = await db.select().from(users).where(eq(users.telegramId, tg.id));
  if (existing) {
    if (existing.firstName === tg.first_name && existing.username === username) return existing;
    const [updated] = await db
      .update(users)
      .set({ firstName: tg.first_name, username })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(users)
    .values({ telegramId: tg.id, firstName: tg.first_name, username, timezone: DEFAULT_TIMEZONE, createdAt: now })
    .returning();
  return created;
}

export async function getUserByTelegramId(db: Db, telegramId: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  return user;
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function updateUser(db: Db, id: number, patch: UserPatch): Promise<User> {
  const set: UserPatch & { lastRooms?: string } = patch;
  const [user] = await db.update(users).set(set).where(eq(users.id, id)).returning();
  return user;
}

export async function setActiveLearningLimit(db: Db, userId: number, limit: number): Promise<User | undefined> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEARNING_LIMIT) return undefined;
  // Смена предела и запись первого ответа используют одну блокировку.
  return withCombatLock(db, () => updateUser(db, userId, { activeLearningLimit: limit }));
}

/**
 * Записать, откуда человек пришёл, — **один раз за всю жизнь**. Второй переход по ссылке ничего не меняет:
 * иначе последний канал переписывал бы историю, и через месяц все выглядели бы пришедшими из него.
 * Пустой `source` игнорируем: лучше `null` («неизвестно»), чем затереть известное пустым.
 */
export async function setSourceOnce(db: Db, userId: number, source: string, now: Date): Promise<void> {
  if (!source) return;
  const [user] = await db.select({ sourceAt: users.sourceAt }).from(users).where(eq(users.id, userId));
  if (!user || user.sourceAt != null) return;
  await db.update(users).set({ source, sourceAt: now }).where(eq(users.id, userId));
}

/**
 * Пояс с телефона: Telegram его не отдаёт, а при регистрации он угадан по умолчанию.
 *
 * Приложение знает настоящий пояс (`Intl.DateTimeFormat().resolvedOptions().timeZone`), поэтому присланное
 * значение заменяет догадку — и продолжает заменять, если человек переехал. Флаг `timezoneFromDevice`
 * отличает настоящее значение от угаданного.
 *
 * Вместе с поясом человека двигается и пояс комнат, которые он создал: иначе комнаты, заведённые до
 * появления настоящего пояса, навсегда остались бы на догадке (у всех — Новосибирск), а их неделя босса
 * кончалась бы не тогда, когда кончается неделя у автора. Комнаты, у которых пояс уже разошёлся с
 * прежним поясом автора, не трогаем: значит его выбрали отдельно.
 */
export async function adoptDeviceTimeZone(db: Db, userId: number, timeZone: string): Promise<void> {
  if (!isTimeZone(timeZone)) return;
  const [user] = await db.select({ timezone: users.timezone, fromDevice: users.timezoneFromDevice }).from(users).where(eq(users.id, userId));
  if (!user) return;
  // Уже настоящий и не изменился — не пишем лишний раз на каждый запуск приложения.
  if (user.fromDevice && user.timezone === timeZone) return;
  await db.update(users).set({ timezone: timeZone, timezoneFromDevice: true }).where(eq(users.id, userId));
  await db.update(rooms)
    .set({ timezone: timeZone })
    .where(and(eq(rooms.createdBy, userId), eq(rooms.timezone, user.timezone)));
}

/** {"en": 7} — последняя комната (ключ остался от времён двух языков). */
export function parseLastRooms(json: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}
