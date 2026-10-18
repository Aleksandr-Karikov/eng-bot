import type { Room } from "./db/schema";
import { HTML } from "./bot/context";
import { audioKeyboard, learnKeyboard } from "./bot/keyboards";
import { digestText, dueNoticeText, goalReachedText, reminderText, weeklyReportText, wordOfDayText } from "./bot/texts";
import { collectWeeklyReports } from "./services/weekly-report";
import { collectGoalsReached, lastWeekProgress } from "./services/goals";
import { collectWordsOfDay } from "./services/word-of-day";
import { collectDigests } from "./services/digest";
import { listMembers } from "./services/rooms";
import type { Db } from "./db/client";
import type { Notifier } from "./notifier";
import { collectDueNotices, collectReminders, markDueNotice, markReminded } from "./services/reminders";

export interface ReminderDeps {
  db: Db;
  notifier: Pick<Notifier, "dm">;
  now: () => Date;
}

/** Отправляет напоминания тем, кому пора. Возвращает число доставленных. */
export async function sendReminders(deps: ReminderDeps): Promise<number> {
  let sent = 0;
  for (const { user, dueCount, date, friend } of await collectReminders(deps.db, deps.now())) {
    try {
      if (await deps.notifier.dm(user, reminderText(dueCount, friend), { ...HTML, reply_markup: learnKeyboard() })) {
        await markReminded(deps.db, user.id, date);
        // Ежедневное напоминание тоже считается уведомлением — чтобы «слова появились» не пришло следом.
        await markDueNotice(deps.db, user.id, deps.now());
        sent++;
      }
    } catch (err) {
      console.error("Reminder failed, will retry next tick", user.telegramId, err);
    }
  }
  return sent;
}

export interface DigestDeps {
  db: Db;
  notifier: Pick<Notifier, "dm" | "group">;
  now: () => Date;
  /** История из слов недели — в группу вслед за дайджестом. Пишется около минуты, поэтому не ждём. */
  story?: (room: Room) => Promise<unknown>;
}

/** «Снова появились слова» — между ежедневными напоминаниями. Возвращает число доставленных. */
export async function sendDueNotices(deps: ReminderDeps): Promise<number> {
  let sent = 0;
  for (const { user, dueCount } of await collectDueNotices(deps.db, deps.now())) {
    try {
      if (await deps.notifier.dm(user, dueNoticeText(dueCount), { ...HTML, reply_markup: learnKeyboard() })) {
        await markDueNotice(deps.db, user.id, deps.now());
        sent++;
      }
    } catch (err) {
      console.error("Due notice failed, will retry", user.telegramId, err);
    }
  }
  return sent;
}

/** Еженедельный дайджест: в привязанную группу, а если её нет — каждому участнику в личку. */
export async function sendDigests(deps: DigestDeps): Promise<void> {
  for (const { room, rows, duels } of await collectDigests(deps.db, deps.now())) {
    const text = digestText(room.name, rows, duels, await lastWeekProgress(deps.db, room, deps.now()));
    try {
      // Если в группу отправить не вышло (бота убрали из чата), шлём каждому в личку, чтобы итоги не потерялись.
      const posted = room.telegramChatId != null && (await deps.notifier.group(room.telegramChatId, text, HTML));
      if (!posted) for (const member of await listMembers(deps.db, room.id)) await deps.notifier.dm(member, text, HTML);
      if (posted && deps.story) void deps.story(room).catch((err) => console.error("Weekly story failed", room.id, err));
    } catch (err) {
      console.error("Digest failed", room.id, err);
    }
  }
}

/** Комната выполнила цель недели — поздравляем один раз: в группу, а если её нет — каждому в личку. */
export async function sendGoalsReached(deps: DigestDeps): Promise<void> {
  for (const { room, progress } of await collectGoalsReached(deps.db, deps.now())) {
    const text = goalReachedText(room.name, progress);
    try {
      const posted = room.telegramChatId != null && (await deps.notifier.group(room.telegramChatId, text, HTML));
      if (!posted) for (const member of await listMembers(deps.db, room.id)) await deps.notifier.dm(member, text, HTML);
    } catch (err) {
      console.error("Goal message failed", room.id, err);
    }
  }
}

/** Личный итог недели — каждому в личку. */
export async function sendWeeklyReports(deps: DigestDeps): Promise<void> {
  for (const { user, report } of await collectWeeklyReports(deps.db, deps.now())) {
    try {
      await deps.notifier.dm(user, weeklyReportText(report), HTML);
    } catch (err) {
      console.error("Weekly report failed", user.telegramId, err);
    }
  }
}

/** Слово дня — в привязанные группы. */
export async function sendWordsOfDay(deps: DigestDeps): Promise<void> {
  for (const { room, word } of await collectWordsOfDay(deps.db, deps.now())) {
    if (room.telegramChatId == null) continue;
    await deps.notifier.group(room.telegramChatId, wordOfDayText(word), { ...HTML, reply_markup: audioKeyboard(word.id) });
  }
}

export function startReminderLoop(deps: DigestDeps, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendReminders(deps);
      await sendDueNotices(deps);
      await sendDigests(deps);
      await sendGoalsReached(deps);
      await sendWeeklyReports(deps);
      await sendWordsOfDay(deps);
    } catch (err) {
      console.error("Reminder tick failed", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
