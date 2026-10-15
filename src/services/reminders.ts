import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type User } from "../db/schema";
import { localParts } from "../time";
import { countDue } from "./review";
import { updateUser } from "./users";

export interface Reminder {
  user: User;
  dueCount: number;
}

export async function collectReminders(db: Db, now: Date): Promise<Reminder[]> {
  const candidates = await db.select().from(users).where(eq(users.canDm, true));
  const reminders: Reminder[] = [];
  for (const user of candidates) {
    const { date, time } = localParts(user.timezone, now);
    if (time < user.reminderTime || user.lastReminderDate === date) continue;
    await updateUser(db, user.id, { lastReminderDate: date });
    const dueCount = await countDue(db, user.id, now);
    if (dueCount > 0) reminders.push({ user, dueCount });
  }
  return reminders;
}
