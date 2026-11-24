import type { Room } from "./db/schema";
import { HTML } from "./bot/context";
import { audioKeyboard, learnKeyboard } from "./bot/keyboards";
import { digestText, dueNoticeText, goalReachedText, reminderText, trophiesText, weeklyReportText, wordOfDayText } from "./bot/texts";
import { collectWeeklyReports, markWeeklyReportSent } from "./services/weekly-report";
import { collectGoalsReached, lastWeekProgress, markGoalReached } from "./services/goals";
import { collectTrophies } from "./services/trophies";
import { collectWordsOfDay, markWordOfDaySent } from "./services/word-of-day";
import { collectDigests, markDigestSent } from "./services/digest";
import { listMembers } from "./services/rooms";
import { bossEnabled, bossFeed } from "./services/boss";
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
  for (const { user, due, date, friend, lastChance } of await collectReminders(deps.db, deps.now())) {
    try {
      if (await deps.notifier.dm(user, reminderText(due, friend, lastChance), { ...HTML, reply_markup: learnKeyboard() })) {
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
  /**
   * Общий рубильник `BOSS_ENABLED`: false — режим выключен всем, и поздравления про босса в личку
   * не уходят тем, кто его не видит (E12). В группу сообщение всё равно отправляется: комната — не
   * адресат настройки, и историю недели терять незачем.
   */
  bossEnabled?: boolean;
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
  for (const { room, rows, duels, date } of await collectDigests(deps.db, deps.now())) {
    const text = digestText(room.name, rows, duels, await lastWeekProgress(deps.db, room, deps.now()));
    try {
      // Если в группу отправить не вышло (бота убрали из чата), шлём каждому в личку, чтобы итоги не потерялись.
      const posted = room.telegramChatId != null && (await deps.notifier.group(room.telegramChatId, text, HTML));
      let delivered = posted;
      if (!posted) {
        for (const member of await listMembers(deps.db, room.id)) delivered = (await deps.notifier.dm(member, text, HTML)) || delivered;
      }
      // Отмечаем только то, что действительно ушло: иначе сбой Telegram съедал итог навсегда.
      if (delivered) await markDigestSent(deps.db, room.id, date);
      if (posted && deps.story) void deps.story(room).catch((err) => console.error("Weekly story failed", room.id, err));
    } catch (err) {
      console.error("Digest failed, will retry next tick", room.id, err);
    }
  }
}

/** Комната выполнила цель недели — поздравляем один раз: в группу, а если её нет — каждому в личку. */
export async function sendGoalsReached(deps: DigestDeps): Promise<void> {
  for (const { room, progress, date } of await collectGoalsReached(deps.db, deps.now())) {
    const now = deps.now();
    // Добивающий удар — из той же ленты, что видит Mini App: иначе чат говорит «выполнила цель»,
    // а приложение показывает имя того, кто её закрыл (E12). Ошибку расчёта не превращаем в потерю
    // поздравления: без удара текст всё равно верный.
    const blow = await bossFeed(deps.db, room, now, 1, progress.target)
      .then((feed) => feed.finalBlow)
      .catch(() => undefined);
    const text = goalReachedText(room.name, progress, blow);
    try {
      const posted = room.telegramChatId != null && (await deps.notifier.group(room.telegramChatId, text, HTML));
      let delivered = posted;
      if (!posted) {
        // В личку — только тем, у кого режим включён: остальным это сообщение про игру, которую они
        // выключили себе в /settings. В группу шлём всем: там читают и те, кто играет (E12).
        const recipients = (await listMembers(deps.db, room.id)).filter((member) => bossEnabled(member, deps.bossEnabled));
        for (const member of recipients) delivered = (await deps.notifier.dm(member, text, HTML)) || delivered;
      }
      if (delivered) await markGoalReached(deps.db, room.id, date);
    } catch (err) {
      console.error("Goal message failed, will retry next tick", room.id, err);
    }
  }
}

/**
 * 🏆 Трофеи за закрытую неделю — каждому в личку, кто что-то получил.
 *
 * `onlyFreshWeeks` — комнату, за которую неделя уже посчитана (`rooms.trophies_week`), пропускаем
 * до всякой работы. Без этого признака расчёт шёл на каждом тике (раз в минуту): он читает всю таблицу
 * `trophies` и считает `weekFacts` по каждой комнате, то есть ~10 080 прогонов в неделю вместо одного
 * на комнату (E11). Скрипт бэкфилла этот флаг не ставит — он пересчитывает прошлые недели намеренно.
 */
export async function sendTrophies(deps: DigestDeps): Promise<void> {
  for (const { user, earned } of await collectTrophies(deps.db, deps.now(), { onlyFreshWeeks: true })) {
    if (earned.length === 0) continue;
    const text = trophiesText(earned);
    try {
      await deps.notifier.dm(user, text, HTML);
    } catch (err) {
      console.error("Trophy message failed", user.telegramId, err);
    }
  }
}

/** Личный итог недели — каждому в личку. */
export async function sendWeeklyReports(deps: DigestDeps): Promise<void> {
  for (const { user, report, date } of await collectWeeklyReports(deps.db, deps.now())) {
    try {
      if (await deps.notifier.dm(user, weeklyReportText(report), HTML)) await markWeeklyReportSent(deps.db, user.id, date);
    } catch (err) {
      console.error("Weekly report failed, will retry next tick", user.telegramId, err);
    }
  }
}

/** Слово дня — в привязанные группы. */
export async function sendWordsOfDay(deps: DigestDeps): Promise<void> {
  for (const { room, word, date } of await collectWordsOfDay(deps.db, deps.now())) {
    if (room.telegramChatId == null) continue;
    const sent = await deps.notifier.group(room.telegramChatId, wordOfDayText(word), { ...HTML, reply_markup: audioKeyboard(word.id) });
    // Пометка после доставки: иначе сбой терял слово дня навсегда и выбивал слово из выбора на месяц.
    if (sent) await markWordOfDaySent(deps.db, room.id, word.id, date, deps.now());
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
      await sendTrophies(deps);
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
