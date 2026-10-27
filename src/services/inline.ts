import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { roomMembers, rooms, words, type Word } from "../db/schema";
import { normalizeTerm } from "./words";

/** Сколько подсказок отдаём: больше человек всё равно не листает. */
export const INLINE_LIMIT = 8;

/** Минимальная длина запроса: на одну букву словарь отдаст случайный мусор. */
export const INLINE_MIN_CHARS = 2;

export interface InlineHit {
  word: Word;
  /** Название комнаты, где слово лежит, — чтобы показать, откуда оно, когда комнат несколько. */
  roomName: string;
  /** Слово добавил сам человек (а не оно пришло из общей комнаты). */
  mine: boolean;
}

/**
 * Что показать в инлайн-режиме по набранному тексту.
 *
 * **Поиск по своим словам, без вызова модели.** Инлайн требует ответа примерно за 10 секунд (Telegram
 * просто перестаёт показывать подсказки), а самый дешёвый `enrich` — это 0.8–1.3 с плюс риск встать
 * в очередь, когда `Limiter` занят чужими запросами. Поэтому здесь — только то, что уже переведено.
 * Сам запрос тоже умеет переводиться, но это делает обработчик (`handlers/inline.ts`), и только когда
 * поиск ничего не нашёл.
 *
 * Ищем по всем комнатам человека: у инлайн-апдейта нет чата, поэтому «текущей» комнаты в этот момент
 * не существует. Фильтруем в JS, а не через `LIKE`, — так запрос остаётся переносимым (инвариант 3),
 * как в `listRoomWords`.
 */
export async function findInlineWords(db: Db, userId: number, query: string): Promise<InlineHit[]> {
  const needle = normalizeTerm(query);
  if (needle.length < INLINE_MIN_CHARS) return [];

  const memberships = await db.select({ roomId: roomMembers.roomId }).from(roomMembers).where(eq(roomMembers.userId, userId));
  const roomIds = memberships.map((m) => m.roomId);
  if (roomIds.length === 0) return [];

  const rows = await db
    .select({ word: words, roomName: rooms.name })
    .from(words)
    .innerJoin(rooms, eq(words.roomId, rooms.id))
    .where(inArray(words.roomId, roomIds));

  const exact = (hit: { word: Word }): boolean => hit.word.termNormalized === needle;
  const starts = (hit: { word: Word }): boolean => hit.word.termNormalized.startsWith(needle);
  const found = rows.filter((hit) => hit.word.termNormalized.includes(needle));
  // Точное совпадение первым, потом «начинается с», потом короткие: набрав слово целиком, человек ждёт его.
  found.sort((a, b) => {
    if (exact(a) !== exact(b)) return exact(a) ? -1 : 1;
    if (starts(a) !== starts(b)) return starts(a) ? -1 : 1;
    return a.word.term.length - b.word.term.length;
  });

  const seen = new Set<string>();
  const hits: InlineHit[] = [];
  for (const hit of found) {
    // Одно и то же слово бывает в нескольких комнатах — в подсказках показываем один раз.
    if (seen.has(hit.word.termNormalized)) continue;
    seen.add(hit.word.termNormalized);
    hits.push({ word: hit.word, roomName: hit.roomName, mine: hit.word.addedBy === userId });
    if (hits.length >= INLINE_LIMIT) break;
  }
  return hits;
}

/** Сколько слов ещё считаем «словом или фразой», а не текстом: `set off`, `break the ice`. */
export const INLINE_MAX_WORDS = 4;

/**
 * Похоже ли на слово или короткую фразу, которую имеет смысл переводить.
 *
 * Инлайн открыт кому угодно, включая случайно набранный мусор, и каждый запрос здесь — это расход
 * на модель. Поэтому отсекаем заведомое: длинный текст (для него есть `/check` и `/add`), строки
 * без букв, наборы одинаковых символов и «предложения» из многих слов.
 *
 * Ограничение по словам, а не только по длине: «это целое предложение из многих слов» — это 51 символ,
 * то есть по длине проходит, а переводить его в подсказке бессмысленно и дорого.
 */
export function looksLikeWord(query: string): boolean {
  const q = query.trim();
  if (q.length < INLINE_MIN_CHARS || q.length > 60) return false;
  if (!/\p{L}/u.test(q)) return false;
  // «ааааааа» и «........» — не слово.
  if (new Set(q.replace(/\s/g, "")).size < 2) return false;
  return q.split(/\s+/).length <= INLINE_MAX_WORDS;
}
