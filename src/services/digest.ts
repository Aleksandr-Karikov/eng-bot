import { wordUsesSince } from "./word-uses";
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms, words, type Room } from "../db/schema";
import { localParts, localMoment, previousDate } from "../time";
import { weeklyDuelPoints, type DuelScore } from "./duels";
import { listMembers } from "./rooms";
import { personalStats, roomLeaderboard } from "./stats";

/** Дайджест и граница недели — по воскресеньям в 20:00 по поясу комнаты. */
export const DIGEST_TIME = "20:00";
export const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Если бот не работал в воскресенье вечером, дайджест догоняет в течение двух суток. */
const CATCH_UP_MS = 48 * 60 * 60_000;

/** Пояс комнат, у которых свой не задан: старые строки до миграции 0055 и комнаты без автора. */
export const FALLBACK_TZ = "Asia/Novosibirsk";

/** Пояс комнаты. Единственное место, где решается, чей пояс считать «поясом недели». */
export function roomTimeZone(room: { timezone?: string | null }): string {
  return room.timezone && room.timezone.length > 0 ? room.timezone : FALLBACK_TZ;
}

/**
 * Последний момент «воскресенье 20:00» по поясу комнаты, не позже now — начало текущей недели.
 *
 * Пояс — параметр, а не константа: в комнате, созданной в Москве, неделя должна кончаться в 20:00 МСК,
 * а не в 20:00 по Новосибирску. Поэтому же здесь нет зашитого «+07:00»: смещение считается через
 * `localMoment` и учитывает летнее время.
 */
export function latestDigestMoment(now: Date, timeZone: string = FALLBACK_TZ): { date: string; at: Date } {
  let day = localParts(timeZone, now).date;
  for (let i = 0; i < 14; i++, day = previousDate(day)) {
    if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 0) continue;
    const at = localMoment(timeZone, day, DIGEST_TIME);
    if (at.getTime() <= now.getTime()) return { date: day, at };
  }
  throw new Error("unreachable: a Sunday within two weeks");
}

/** Дата (воскресенье) дайджеста, который пора отправить, иначе null. Пояс — комнаты. */
export function digestDue(room: { lastDigestDate: string | null; timezone?: string | null }, now: Date): string | null {
  const due = latestDigestMoment(now, roomTimeZone(room));
  if (now.getTime() - due.at.getTime() > CATCH_UP_MS) return null;
  if ((room.lastDigestDate ?? "") >= due.date) return null;
  return due.date;
}

export interface DigestRow {
  userId: number;
  name: string;
  /** Слов добавлено в комнату за неделю. */
  added: number;
  reviews7d: number;
  learned: number;
  streak: number;
  /** Слов комнаты, употреблённых в разговоре в группе. */
  used: number;
}

/**
 * Итоги за закрытую неделю комнаты.
 *
 * Неделя — от воскресенья 20:00 пояса комнаты до следующего, а не «последние 7 суток от now»: дайджест
 * уходит в воскресенье вечером, и окно должно быть ровно той неделей, о которой он рассказывает.
 */
export async function weeklyDigest(db: Db, roomId: number, now: Date, timeZone: string = FALLBACK_TZ): Promise<DigestRow[]> {
  const weekStart = latestDigestMoment(now, timeZone).at;
  const weekAgo = new Date(weekStart.getTime() - WEEK_MS);
  const board = await roomLeaderboard(db, roomId, now);
  const recentWords = await db
    .select({ addedBy: words.addedBy })
    .from(words)
    .where(and(eq(words.roomId, roomId), gte(words.createdAt, weekAgo)));
  const members = await listMembers(db, roomId);
  const uses = await wordUsesSince(db, roomId, weekAgo);
  const rows: DigestRow[] = [];
  for (const member of members) {
    const row = board.find((r) => r.userId === member.id);
    rows.push({
      userId: member.id,
      name: member.firstName,
      added: recentWords.filter((w) => w.addedBy === member.id).length,
      reviews7d: row?.reviews7d ?? 0,
      learned: row?.learned ?? 0,
      streak: (await personalStats(db, member, now)).streak,
      used: uses.get(member.id) ?? 0,
    });
  }
  return rows.sort((a, b) => b.reviews7d - a.reviews7d || b.added - a.added);
}

/**
 * Комнаты, которым пора отправить дайджест. **Не помечает** — дата возвращается наружу, и отметку
 * ставит `markDigestSent` уже после успешной доставки.
 *
 * Так же сделано в напоминаниях (`markReminded` после `notifier.dm === true`), и это не формальность:
 * раньше отметка стояла здесь, до отправки, и сбой Telegram (или бота убрали из чата) означал, что
 * недельный итог не придёт **никогда** — дата уже записана, следующий тик её пропускал. Пустые недели
 * без активности по-прежнему пропускаются: там нечего отправлять.
 */
export async function collectDigests(
  db: Db,
  now: Date,
): Promise<Array<{ room: Room; rows: DigestRow[]; duels: DuelScore[]; date: string }>> {
  const result: Array<{ room: Room; rows: DigestRow[]; duels: DuelScore[]; date: string }> = [];
  for (const room of await db.select().from(rooms)) {
    const date = digestDue(room, now);
    if (!date) continue;
    const rows = await weeklyDigest(db, room.id, now, roomTimeZone(room));
    const duels = await weeklyDuelPoints(db, room.id, now);
    if (rows.some((r) => r.added > 0 || r.reviews7d > 0 || r.used > 0) || duels.length) result.push({ room, rows, duels, date });
  }
  return result;
}

/** Отметить дайджест отправленным. Ставится после доставки — см. `collectDigests`. */
export async function markDigestSent(db: Db, roomId: number, date: string): Promise<void> {
  await db.update(rooms).set({ lastDigestDate: date }).where(eq(rooms.id, roomId));
}

/**
 * Чей пояс где считать — одно правило на весь проект.
 *
 * Поясов два, и они не взаимозаменяемы:
 *
 * - **Пояс комнаты** (`roomTimeZone`) — всё, что принадлежит неделе комнаты: её граница, босс, цель,
 *   монеты комнаты, трофеи, дайджест, слово дня. Неделя у комнаты одна, поэтому она не может зависеть
 *   от того, где сейчас его участники. Пояс хранится в `rooms.timezone` и заполняется поясом автора.
 * - **Пояс человека** (`users.timezone`) — всё личное и по часам: ежедневное напоминание, «слова снова
 *   появились», личный недельный итог, квоты. Человеку удобно получать сообщения в своём времени, и
 *   переезд не должен сдвигать его будильник.
 * - **Кошелёк** (`coinsPeriod`) — исключение внутри личного: граница монет держится на поясе человека,
 *   потому что кошелёк общий для комнат. Если бы монеты шли по поясу комнаты, переход между комнатами
 *   с разными поясами сменил бы ключ периода и обнулил `coinsSpent` — одни и те же монеты потратились
 *   бы дважды. Это записано в `coinsPeriod` (`src/services/boss.ts`).
 *
 * Правило было размыто, и из-за этого напоминание «последний шанс» приходило уже после сброса недели:
 * в комнате с НСК-поясом неделя кончается в 20:00 НСК, а напоминание человеку в МСК — в 20:00 МСК,
 * то есть на 4 часа позже. Поэтому то, что говорит про неделю, считается по комнате (`roomWeekMoment`),
 * а то, что про человека, — по нему.
 */

/** Начало текущей недели комнаты — по её поясу. Единственная точка для «когда кончается неделя». */
export function roomWeekMoment(room: { timezone?: string | null }, now: Date): { date: string; at: Date } {
  return latestDigestMoment(now, roomTimeZone(room));
}

/**
 * Осталось ли меньше `hours` часов до конца недели комнаты.
 *
 * Нужно для «последнего шанса»: предупредить надо ДО сброса, а не после. Сравнение идёт в поясе комнаты,
 * поэтому человек в другом поясе получает предупреждение вовремя относительно своей же недели.
 */
export function nearWeekEnd(room: { timezone?: string | null }, now: Date, hours = 6): boolean {
  const end = roomWeekMoment(room, now).at.getTime() + WEEK_MS;
  return end - now.getTime() <= hours * 60 * 60_000;
}
