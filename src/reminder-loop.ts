import { learnKeyboard } from "./bot/keyboards";
import { reminderText } from "./bot/texts";
import type { Db } from "./db/client";
import type { Notifier } from "./notifier";
import { collectReminders } from "./services/reminders";

export function startReminderLoop(
  deps: { db: Db; notifier: Notifier; now: () => Date },
  intervalMs = 60_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const { user, dueCount } of await collectReminders(deps.db, deps.now())) {
        await deps.notifier.dm(user, reminderText(dueCount), { reply_markup: learnKeyboard() });
      }
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
