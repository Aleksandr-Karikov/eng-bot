import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type User } from "../db/schema";
import { localParts } from "../time";
import { countDue } from "./review";
import { updateUser } from "./users";

export interface Reminder {
  user: User;
  dueCount: number;
  /** Локальная дата пользователя — её нужно пометить через markReminded после успешной отправки. */
  date: string;
}

/**
 * Кому пора напомнить. Пользователей без карточек к повторению сразу помечает как «напомнено сегодня»;
 * остальных помечать должен отправитель — только после доставки, иначе сбой сети съест напоминание.
 */
export async function collectReminders(db: Db, now: Date): Promise<Reminder[]> {
  const candidates = await db.select().from(users).where(eq(users.canDm, true));
  const reminders: Reminder[] = [];
  for (const user of candidates) {
    const { date, time } = localParts(user.timezone, now);
    if (time < user.reminderTime || user.lastReminderDate === date) continue;
    const dueCount = await countDue(db, user.id, now);
    if (dueCount > 0) reminders.push({ user, dueCount, date });
    else await markReminded(db, user.id, date);
  }
  return reminders;
}

export async function markReminded(db: Db, userId: number, date: string): Promise<void> {
  await updateUser(db, userId, { lastReminderDate: date });
}
