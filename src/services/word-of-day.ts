import { eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, rooms, words, type Room, type Word } from "../db/schema";
import { localParts } from "../time";
import { roomTimeZone } from "./digest";

/** Слово дня — каждое утро с 10:00 по поясу комнаты, в привязанную группу. */
const WOTD_TIME = "10:00";
const REPEAT_AFTER_MS = 30 * 24 * 60 * 60_000;

/** Локальная дата, если сегодня слово дня ещё не отправляли и уже пора, иначе null. */
export function wordOfDayDue(room: { lastWordOfDayDate: string | null; timezone?: string | null }, now: Date): string | null {
  const { date, time } = localParts(roomTimeZone(room), now);
  return time >= WOTD_TIME && room.lastWordOfDayDate !== date ? date : null;
}

/** Самое слабое для комнаты слово (наименьшая средняя стабильность), не бывшее словом дня последний месяц. */
export async function pickWordOfDay(db: Db, roomId: number, now: Date): Promise<Word | undefined> {
  const roomWords = await db.select().from(words).where(eq(words.roomId, roomId));
  const fresh = roomWords.filter((w) => !w.featuredAt || now.getTime() - w.featuredAt.getTime() > REPEAT_AFTER_MS);
  if (fresh.length === 0) return undefined;
  const stats = await db
    .select({ wordId: cards.wordId, stability: cards.stability })
    .from(cards)
    .where(inArray(cards.wordId, fresh.map((w) => w.id)));
  const avg = (wordId: number) => {
    const s = stats.filter((c) => c.wordId === wordId);
    return s.length ? s.reduce((sum, c) => sum + c.stability, 0) / s.length : 0;
  };
  return fresh.sort((a, b) => avg(a.id) - avg(b.id) || a.id - b.id)[0];
}

/**
 * Группы, которым пора отправить слово дня. **Не помечает** — отметка после доставки
 * (`markWordOfDaySent`), как в напоминаниях. Иначе сбой отправки терял слово дня навсегда,
 * и слово ещё и выпадало из выбора на месяц вперёд.
 */
export async function collectWordsOfDay(db: Db, now: Date): Promise<Array<{ room: Room; word: Word; date: string }>> {
  const result: Array<{ room: Room; word: Word; date: string }> = [];
  for (const room of await db.select().from(rooms).where(isNotNull(rooms.telegramChatId))) {
    const date = wordOfDayDue(room, now);
    if (!date) continue;
    const word = await pickWordOfDay(db, room.id, now);
    if (!word) continue;
    result.push({ room, word, date });
  }
  return result;
}

/** Отметить слово дня отправленным: комната — дату, слово — что оно уже было. Ставится после доставки. */
export async function markWordOfDaySent(db: Db, roomId: number, wordId: number, date: string, now: Date): Promise<void> {
  await db.update(rooms).set({ lastWordOfDayDate: date }).where(eq(rooms.id, roomId));
  await db.update(words).set({ featuredAt: now }).where(eq(words.id, wordId));
}
