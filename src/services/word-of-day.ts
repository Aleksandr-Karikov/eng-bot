import { eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, rooms, words, type Room, type Word } from "../db/schema";
import { localParts } from "../time";

/** Слово дня — каждое утро с 10:00 по Новосибирску, в привязанную группу. */
const WOTD_TZ = "Asia/Novosibirsk";
const WOTD_TIME = "10:00";
const REPEAT_AFTER_MS = 30 * 24 * 60 * 60_000;

/** Локальная дата, если сегодня слово дня ещё не отправляли и уже пора, иначе null. */
export function wordOfDayDue(room: { lastWordOfDayDate: string | null }, now: Date): string | null {
  const { date, time } = localParts(WOTD_TZ, now);
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

/** Группы, которым пора отправить слово дня; помечает и комнату, и слово. */
export async function collectWordsOfDay(db: Db, now: Date): Promise<Array<{ room: Room; word: Word }>> {
  const result: Array<{ room: Room; word: Word }> = [];
  for (const room of await db.select().from(rooms).where(isNotNull(rooms.telegramChatId))) {
    const date = wordOfDayDue(room, now);
    if (!date) continue;
    await db.update(rooms).set({ lastWordOfDayDate: date }).where(eq(rooms.id, room.id));
    const word = await pickWordOfDay(db, room.id, now);
    if (!word) continue;
    await db.update(words).set({ featuredAt: now }).where(eq(words.id, word.id));
    result.push({ room, word });
  }
  return result;
}
