import { and, eq, gt, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, duelPoints, users, words, type Word } from "../db/schema";

export const DUEL_OPTIONS = 4;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface DuelRound {
  wordId: number;
  term: string;
  options: string[];
  correct: number;
}

const isPhrase = (w: Word) => w.term.trim().includes(" ");

export function shuffle<T>(items: T[], rng: () => number): T[] {
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
  if (all.length < DUEL_OPTIONS) return;
  return choiceRound(all, all[Math.floor(rng() * all.length)], rng);
}

export async function buildBossRounds(db: Db, roomId: number, userId: number, rng: () => number, count: number): Promise<DuelRound[]> {
  const all = await db.select().from(words).where(eq(words.roomId, roomId));
  if (all.length < DUEL_OPTIONS) return [];
  const studied = await db.select({ wordId: cards.wordId }).from(cards).innerJoin(words, eq(words.id, cards.wordId))
    .where(and(eq(cards.userId, userId), eq(words.roomId, roomId), gt(cards.reps, 0)));
  const ids = new Set(studied.map(({ wordId }) => wordId));
  return shuffle(all.filter(({ id }) => ids.has(id)), rng).slice(0, count)
    .map((word) => choiceRound(all, word, rng)).filter((round) => round !== undefined);
}

function choiceRound(all: Word[], word: Word, rng: () => number): DuelRound | undefined {
  const translation = word.translation.trim();
  if (!translation) return undefined;
  const used = new Set([translation.toLowerCase()]);
  const others = shuffle(
    all.filter((w) => w.id !== word.id && w.translation.trim().toLowerCase() !== translation.toLowerCase()),
    rng,
  );
  const sameKind = others.filter((w) => isPhrase(w) === isPhrase(word));
  const otherKind = others.filter((w) => isPhrase(w) !== isPhrase(word));
  const distractors: string[] = [];
  for (const w of [...sameKind, ...otherKind]) {
    if (distractors.length === DUEL_OPTIONS - 1) break;
    const next = w.translation.trim();
    const key = next.toLowerCase();
    if (!next || used.has(key)) continue;
    used.add(key);
    distractors.push(next);
  }
  if (distractors.length < DUEL_OPTIONS - 1) return undefined;
  const options = shuffle([translation, ...distractors], rng);
  return { wordId: word.id, term: word.term, options, correct: options.indexOf(translation) };
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
