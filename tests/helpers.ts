import { createDb, type Db } from "../src/db/client";
import type { User } from "../src/db/schema";
import { upsertUser } from "../src/services/users";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** 2026-10-15 16:00 по Новосибирску (12:00 по Москве). */
export const T0 = new Date("2026-10-15T09:00:00Z");
export const at = (ms: number) => new Date(T0.getTime() + ms);

export function testDb(): Db {
  return createDb(":memory:");
}

export function makeUser(db: Db, telegramId: number, firstName = `User${telegramId}`): Promise<User> {
  return upsertUser(db, { id: telegramId, first_name: firstName }, T0);
}
