import { and, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, rooms, users, words, type Room } from "../db/schema";
import { latestDigestMoment, WEEK_MS } from "./digest";
import { bossStrikes } from "./combat-ledger";

/** Автоцель не меньше этого — иначе после пустой недели цель стала бы нулевой. */
const MIN_AUTO_GOAL = 50;
/** Автоцель — на 10% больше прошлой недели, округлённо до десятков. */
const AUTO_GROWTH = 1.1;

export interface GoalProgress {
  target: number;
  done: number;
  /** Урон конкретного человека, если спросили про него: на нём считаются монеты (усиление личное). */
  mine?: number;
  /** Цель задана сама, по прошлой неделе. */
  auto: boolean;
  /** Вклад участников в HP, больше — выше. */
  byUser: Array<{ name: string; count: number }>;
}

/**
 * Базовая цена ответа: «Помню» засчитывается как 2 HP.
 *
 * Отсюда множитель для цели: человек, отвечающий ровно «Помню», добивает босса ровно тогда же,
 * когда дотягивал до цели при подсчёте по одному ответу, — игра ничего не сдвинула. «Легко»
 * и сложные упражнения ускоряют, «Забыл» замедляет, и это единственный способ получить силу.
 */
export const BASE_WEIGHT = 2;

/**
 * Вес ответа в HP. «Забыл» — тоже 1, а не 0: ноль наказывал бы за честность, и стало бы выгодно
 * врать себе «помню», чтобы босс дох. Признался — уже работа.
 */
export function answerWeight(rating: string, stage?: string | null, level = 0, listenLevel = 0, writingLevel = 0): number {
  const base = rating === "easy" ? 3 : rating === "hard" ? 2 : rating === "good" ? 2 : 1;
  // Сложное упражнение — вдвое: человек не узнал слово, а воспроизвёл.
  const hard = stage === "cloze" || stage === "sentence" || stage === "listen" || stage === "app_cloze" || stage === "app_sentence" || stage === "app_listen";
  // +10% за уровень усиления — личное, поэтому применяется к своим ответам, а не к комнате целиком.
  const skill = stage === "listen" || stage === "app_listen" ? listenLevel
    : stage === "cloze" || stage === "app_cloze" || stage === "sentence" || stage === "app_sentence" ? writingLevel : 0;
  return (hard ? base * 2 : base) * (10 + level + 2 * skill) / 10;
}

/**
 * Ответы на карточки слов комнаты в [from, to): сырое число и HP, по участникам.
 *
 * Считаем по userId, а не по имени: усиление личное, поэтому урон каждого свой, и два тёзки в одной
 * комнате не должны сливаться в одного — раньше сливались, хотя вклад в цель это искажало.
 */
async function roomReviews(db: Db, roomId: number, from: Date, to: Date) {
  const rows = await db
    .select({ userId: users.id, name: users.firstName, rating: reviewLogs.rating, stage: reviewLogs.stage, damageDeci: reviewLogs.damageDeci, banked: reviewLogs.banked })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, roomId), gte(reviewLogs.reviewedAt, from), lt(reviewLogs.reviewedAt, to)));
  const raw = new Map<number, number>();
  const hp = new Map<number, number>();
  const names = new Map<number, string>();
  for (const r of rows) {
    names.set(r.userId, r.name);
    raw.set(r.userId, (raw.get(r.userId) ?? 0) + 1);
    if (!r.banked) hp.set(r.userId, (hp.get(r.userId) ?? 0) + (r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10)));
  }
  return { raw, hp, names };
}

const total = (m: Map<number, number>) => Math.round([...m.values()].reduce((a, b) => a + b, 0) * 10) / 10;

export function autoGoal(lastWeek: number): number {
  return Math.max(MIN_AUTO_GOAL, Math.ceil(Math.round(lastWeek * AUTO_GROWTH) / 10) * 10);
}

/**
 * Цель недели в HP. Считается от **числа ответов** прошлой недели, а не от нанесённого урона:
 * иначе усиление раздувало бы следующего босса и обесценивало себя.
 */
export async function goalProgress(db: Db, room: Room, now: Date, weekStart = latestDigestMoment(now).at, userId?: number): Promise<GoalProgress> {
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const current = await roomReviews(db, room.id, weekStart, weekEnd);
  for (const strike of await bossStrikes(db, room.id, weekStart, weekEnd)) {
    current.names.set(strike.userId, strike.name);
    current.hp.set(strike.userId, (current.hp.get(strike.userId) ?? 0) + strike.damageDeci);
  }
  for (const [id, deci] of current.hp) current.hp.set(id, deci / 10);
  const prev = await roomReviews(db, room.id, new Date(weekStart.getTime() - WEEK_MS), weekStart);
  // Цель — в HP и хранится в HP: одно число в /goal, дайджесте и на вкладке босса.
  const target = room.weeklyGoal > 0 ? room.weeklyGoal : autoGoal(total(prev.raw)) * BASE_WEIGHT;
  const byUser = [...current.hp.entries()]
    .map(([userId, count]) => ({ name: current.names.get(userId) ?? "?", count }))
    .sort((a, b) => b.count - a.count);
  return { target, done: total(current.hp), auto: room.weeklyGoal <= 0, byUser, ...(userId !== undefined ? { mine: current.hp.get(userId) ?? 0 } : {}) };
}

/** Прогресс недели, которая только что закончилась (для воскресного дайджеста). */
export function lastWeekProgress(db: Db, room: Room, now: Date): Promise<GoalProgress> {
  return goalProgress(db, room, now, new Date(latestDigestMoment(now).at.getTime() - WEEK_MS));
}

export async function setWeeklyGoal(db: Db, roomId: number, goal: number): Promise<void> {
  await db.update(rooms).set({ weeklyGoal: goal }).where(eq(rooms.id, roomId));
}

/** Комнаты, которые только что выполнили цель недели; помечает, чтобы поздравить один раз. */
export async function collectGoalsReached(db: Db, now: Date): Promise<Array<{ room: Room; progress: GoalProgress }>> {
  const week = latestDigestMoment(now);
  const result: Array<{ room: Room; progress: GoalProgress }> = [];
  const candidates = await db.select().from(rooms).where(or(isNull(rooms.goalReachedWeek), ne(rooms.goalReachedWeek, week.date)));
  for (const room of candidates) {
    const progress = await goalProgress(db, room, now, week.at);
    if (progress.done < progress.target) continue;
    await db.update(rooms).set({ goalReachedWeek: week.date }).where(eq(rooms.id, room.id));
    result.push({ room, progress });
  }
  return result;
}
