import { inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms, words } from "../db/schema";
import { currentLang } from "../lang";

/**
 * Очереди — на языке текущей операции: в корейской комнате /learn и приложение показывают корейские слова,
 * в английской — английские. Кто учит один язык, видит то же, что и раньше.
 */
export async function inCurrentLanguage<T extends { word: { roomId: number } }>(db: Db, items: T[]): Promise<T[]> {
  const of = await roomLanguages(db, items.map((i) => i.word.roomId));
  const lang = currentLang().code;
  return items.filter((i) => (of.get(i.word.roomId) ?? "en") === lang);
}

/** То же для карточек без загруженного слова: оставляет id слов на языке текущей операции. */
export async function wordIdsInCurrentLanguage(db: Db, wordIds: number[]): Promise<Set<number>> {
  if (wordIds.length === 0) return new Set();
  const rows = await db.select({ id: words.id, roomId: words.roomId }).from(words).where(inArray(words.id, [...new Set(wordIds)]));
  return new Set((await inCurrentLanguage(db, rows.map((r) => ({ id: r.id, word: r })))).map((r) => r.id));
}

async function roomLanguages(db: Db, roomIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: rooms.id, language: rooms.language }).from(rooms).where(inArray(rooms.id, ids));
  return new Map(rows.map((r) => [r.id, r.language]));
}
