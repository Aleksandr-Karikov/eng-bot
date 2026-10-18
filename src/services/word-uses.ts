import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { wordUses, words } from "../db/schema";

/** Одно и то же слово у одного человека засчитываем не чаще раза в сутки — иначе 👏 на каждое «meanwhile». */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** «someone», «one's» в словарной фразе — на их месте в речи стоит что угодно. */
const PLACEHOLDERS = new Set(["someone", "somebody", "something", "one's", "someone's", "smb", "sth"]);

/** Частицы фразовых глаголов: между глаголом и ними может стоять дополнение (tone it down). */
const PARTICLES = new Set(["up", "down", "off", "out", "in", "on", "over", "away", "back", "around"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Слово и его обычные формы: -s, -es, -ed, -d, -ing, -'s, удвоение согласной, e/y на конце. */
function tokenPattern(token: string): string {
  if (PLACEHOLDERS.has(token)) return "\\S+(?:\\s+\\S+)?";
  const t = escapeRe(token);
  if (token.length <= 2 || !/^[a-z]+$/.test(token)) return t;
  const forms = [`${t}(?:s|es|ed|d|ing|'s)?`, `${t}${token.at(-1)}(?:ed|ing)`];
  if (token.endsWith("e")) forms.push(`${escapeRe(token.slice(0, -1))}ing`);
  if (token.endsWith("y")) forms.push(`${escapeRe(token.slice(0, -1))}(?:ies|ied)`);
  return `(?:${forms.join("|")})`;
}

const normalize = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'");

export function termPattern(term: string): RegExp {
  const tokens = normalize(term).replace(/^to\s+/, "").split(/\s+/).filter(Boolean);
  const body = tokens
    .map((token, i) => (i > 0 && PARTICLES.has(token) ? `(?:\\S+\\s+)?${tokenPattern(token)}` : tokenPattern(token)))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}'])${body}(?![\\p{L}])`, "u");
}

/** id слов комнаты, употреблённых в тексте. Сообщение из одного слова не считается — это скорее вопрос «что такое …?». */
export function findUsedWords(text: string, roomWords: Array<{ id: number; term: string }>): number[] {
  const normalized = normalize(text);
  if (normalized.trim().split(/\s+/).length < 2) return [];
  return roomWords.filter((w) => termPattern(w.term).test(normalized)).map((w) => w.id);
}

/** Записывает употреблённые слова (кроме недавно засчитанных) и возвращает новые. */
export async function recordWordUses(db: Db, input: { roomId: number; userId: number; text: string; now: Date }): Promise<number[]> {
  const roomWords = await db.select({ id: words.id, term: words.term }).from(words).where(eq(words.roomId, input.roomId));
  const used = findUsedWords(input.text, roomWords);
  if (used.length === 0) return [];
  const recent = await db
    .select({ wordId: wordUses.wordId })
    .from(wordUses)
    .where(and(eq(wordUses.userId, input.userId), gte(wordUses.createdAt, new Date(input.now.getTime() - COOLDOWN_MS))));
  const fresh = used.filter((id) => !recent.some((r) => r.wordId === id));
  if (fresh.length) {
    await db.insert(wordUses).values(fresh.map((wordId) => ({ roomId: input.roomId, userId: input.userId, wordId, createdAt: input.now })));
  }
  return fresh;
}

/** Сколько слов комнаты каждый употребил в разговоре с `since`. */
export async function wordUsesSince(db: Db, roomId: number, since: Date): Promise<Map<number, number>> {
  const rows = await db
    .select({ userId: wordUses.userId })
    .from(wordUses)
    .where(and(eq(wordUses.roomId, roomId), gte(wordUses.createdAt, since)));
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.userId, (counts.get(r.userId) ?? 0) + 1);
  return counts;
}
