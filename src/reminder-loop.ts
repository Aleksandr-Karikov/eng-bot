import { learnKeyboard } from "./bot/keyboards";
import { reminderText } from "./bot/texts";
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
  for (const { user, dueCount, date } of await collectReminders(deps.db, deps.now())) {
    try {
      if (await deps.notifier.dm(user, reminderText(dueCount), { reply_markup: learnKeyboard() })) {
        await markReminded(deps.db, user.id, date);
        sent++;
      }
    } catch (err) {
      console.error("Reminder failed, will retry next tick", user.telegramId, err);
    }
  }
  return sent;
}

export function startReminderLoop(deps: ReminderDeps, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendReminders(deps);
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
