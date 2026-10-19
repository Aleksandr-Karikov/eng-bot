import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs, users, type User } from "../db/schema";
import { localParts } from "../time";
import { countDueSplit } from "./review";
import { listMembers, listUserRooms } from "./rooms";
import { updateUser } from "./users";

export interface FriendToday {
  name: string;
  reviews: number;
}

export interface Reminder {
  user: User;
  /** К повторению и новые — по отдельности. */
  due: { review: number; fresh: number };
  /** Самый активный сегодня участник комнат пользователя — для мотивашки. */
  friend?: FriendToday;
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
    const due = await countDueSplit(db, user.id, now);
    if (due.review + due.fresh > 0) reminders.push({ user, due, date, friend: await friendToday(db, user, date, now) });
    else await markReminded(db, user.id, date);
  }
  return reminders;
}

export async function markReminded(db: Db, userId: number, date: string): Promise<void> {
  await updateUser(db, userId, { lastReminderDate: date });
}

/** Кто из участников комнат пользователя больше всех повторил сегодня (по его локальной дате). */
export async function friendToday(db: Db, user: User, today: string, now: Date): Promise<FriendToday | undefined> {
  // Берём с запасом за двое суток и фильтруем по локальной дате пользователя.
  const since = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
  const friends = new Map<number, User>();
  for (const room of await listUserRooms(db, user.id)) {
    for (const m of await listMembers(db, room.id)) if (m.id !== user.id) friends.set(m.id, m);
  }
  let best: FriendToday | undefined;
  for (const friend of friends.values()) {
    const logs = await db
      .select({ reviewedAt: reviewLogs.reviewedAt })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, friend.id), gte(reviewLogs.reviewedAt, since)));
    const reviews = logs.filter((l) => localParts(user.timezone, l.reviewedAt).date === today).length;
    if (reviews > 0 && reviews > (best?.reviews ?? 0)) best = { name: friend.firstName, reviews };
  }
  return best;
}

/** «Слова снова появились»: не меньше MIN_DUE слов, не чаще раза в NOTICE_EVERY_MS, днём и не сразу после занятия. */
const MIN_DUE = 5;
const NOTICE_EVERY_MS = 3 * 60 * 60_000;
const QUIET_AFTER_STUDY_MS = 60 * 60_000;
const DAY_FROM = "09:00";
const DAY_TO = "22:00";

export interface DueNotice {
  user: User;
  dueCount: number;
}

export async function collectDueNotices(db: Db, now: Date): Promise<DueNotice[]> {
  const candidates = await db
    .select()
    .from(users)
    .where(and(eq(users.canDm, true), eq(users.notifyDue, true)));
  const notices: DueNotice[] = [];
  for (const user of candidates) {
    const { time } = localParts(user.timezone, now);
    if (time < DAY_FROM || time >= DAY_TO) continue;
    if (user.lastDueNoticeAt && now.getTime() - user.lastDueNoticeAt.getTime() < NOTICE_EVERY_MS) continue;
    const [last] = await db
      .select({ at: reviewLogs.reviewedAt })
      .from(reviewLogs)
      .where(eq(reviewLogs.userId, user.id))
      .orderBy(desc(reviewLogs.reviewedAt))
      .limit(1);
    if (last && now.getTime() - last.at.getTime() < QUIET_AFTER_STUDY_MS) continue;
    // «Снова появились слова» — только про повторение: новые слова и так пришли с «знаешь?».
    const dueCount = (await countDueSplit(db, user.id, now)).review;
    if (dueCount >= MIN_DUE) notices.push({ user, dueCount });
  }
  return notices;
}

export async function markDueNotice(db: Db, userId: number, now: Date): Promise<void> {
  await updateUser(db, userId, { lastDueNoticeAt: now });
}
