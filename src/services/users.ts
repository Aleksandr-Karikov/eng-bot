import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type User } from "../db/schema";

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
}

export type UserPatch = Partial<
  Pick<User, "canDm" | "reminderTime" | "currentRoomId" | "lastReminderDate" | "groupHintSent">
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
    .values({ telegramId: tg.id, firstName: tg.first_name, username, createdAt: now })
    .returning();
  return created;
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function updateUser(db: Db, id: number, patch: UserPatch): Promise<User> {
  const [user] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return user;
}
