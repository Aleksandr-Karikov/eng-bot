import { learnKeyboard } from "./bot/keyboards";
import { HTML } from "./bot/context";
import { digestText, reminderText } from "./bot/texts";
import { collectDigests } from "./services/digest";
import { listMembers } from "./services/rooms";
import type { Db } from "./db/client";
import type { Notifier } from "./notifier";
import { collectReminders, markReminded } from "./services/reminders";

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
}

/** Еженедельный дайджест: в привязанную группу, а если её нет — каждому участнику в личку. */
export async function sendDigests(deps: DigestDeps): Promise<void> {
  for (const { room, rows, duels } of await collectDigests(deps.db, deps.now())) {
    const text = digestText(room.name, rows, duels);
    try {
      // Если в группу отправить не вышло (бота убрали из чата), шлём каждому в личку, чтобы итоги не потерялись.
      const posted = room.telegramChatId != null && (await deps.notifier.group(room.telegramChatId, text, HTML));
      if (!posted) for (const member of await listMembers(deps.db, room.id)) await deps.notifier.dm(member, text, HTML);
    } catch (err) {
      console.error("Digest failed", room.id, err);
    }
  }
}

export function startReminderLoop(deps: DigestDeps, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendReminders(deps);
      await sendDigests(deps);
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
