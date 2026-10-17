import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { duelPoints, users, words, type Word } from "../db/schema";

export const DUEL_OPTIONS = 4;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface DuelRound {
  wordId: number;
  term: string;
  options: string[];
  correct: number;
}

const isPhrase = (w: Word) => w.term.trim().includes(" ");

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Случайное слово комнаты и 4 варианта перевода. Неправильные — переводы других слов,
 * по возможности того же вида (слово к слову, фраза к фразе), чтобы не угадывалось по длине.
 */
export async function buildDuelRound(db: Db, roomId: number, rng: () => number): Promise<DuelRound | undefined> {
  const all = await db.select().from(words).where(eq(words.roomId, roomId));
  if (all.length < DUEL_OPTIONS) return undefined;
  const word = all[Math.floor(rng() * all.length)];
  const others = shuffle(
    all.filter((w) => w.id !== word.id && w.translation.trim() !== word.translation.trim()),
    rng,
  );
  const sameKind = others.filter((w) => isPhrase(w) === isPhrase(word));
  const otherKind = others.filter((w) => isPhrase(w) !== isPhrase(word));
  const distractors: string[] = [];
  for (const w of [...sameKind, ...otherKind]) {
    if (distractors.length === DUEL_OPTIONS - 1) break;
    if (!distractors.includes(w.translation)) distractors.push(w.translation);
  }
  if (distractors.length < DUEL_OPTIONS - 1) return undefined;
  const options = shuffle([word.translation, ...distractors], rng);
  return { wordId: word.id, term: word.term, options, correct: options.indexOf(word.translation) };
}

export async function recordDuelPoint(db: Db, roomId: number, userId: number, now: Date): Promise<void> {
  await db.insert(duelPoints).values({ roomId, userId, createdAt: now });
}

export interface DuelScore {
  userId: number;
  name: string;
  points: number;
}

/** Очки дуэлей за последние 7 дней, по убыванию. */
export async function weeklyDuelPoints(db: Db, roomId: number, now: Date): Promise<DuelScore[]> {
  const rows = await db
    .select({ userId: duelPoints.userId, name: users.firstName })
    .from(duelPoints)
    .innerJoin(users, eq(duelPoints.userId, users.id))
    .where(and(eq(duelPoints.roomId, roomId), gte(duelPoints.createdAt, new Date(now.getTime() - WEEK_MS))));
  const scores = new Map<number, DuelScore>();
  for (const r of rows) {
    const s = scores.get(r.userId) ?? { userId: r.userId, name: r.name, points: 0 };
    s.points++;
    scores.set(r.userId, s);
  }
  return [...scores.values()].sort((a, b) => b.points - a.points);
}
