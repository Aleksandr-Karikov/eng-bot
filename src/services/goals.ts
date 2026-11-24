import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, rooms, users, words, type Room } from "../db/schema";
import { latestDigestMoment, roomTimeZone, WEEK_MS } from "./digest";
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

export function damageSkill(stage?: string | null): "listen" | "writing" | undefined {
  if (stage === "listen" || stage === "app_listen") return "listen";
  if (stage === "cloze" || stage === "app_cloze" || stage === "sentence" || stage === "app_sentence") return "writing";
}

/**
 * Вес ответа в HP. «Забыл» — тоже 1, а не 0: ноль наказывал бы за честность, и стало бы выгодно
 * врать себе «помню», чтобы босс дох. Признался — уже работа.
 */
export function answerWeight(rating: string, stage?: string | null, level = 0, listenLevel = 0, writingLevel = 0, relicPercent = 0): number {
  const base = rating === "easy" ? 3 : rating === "hard" ? 2 : rating === "good" ? 2 : 1;
  // Сложное упражнение — вдвое: человек не узнал слово, а воспроизвёл.
  const skill = damageSkill(stage);
  // +10% за уровень усиления — личное, поэтому применяется к своим ответам, а не к комнате целиком.
  const skillLevel = skill === "listen" ? listenLevel : skill === "writing" ? writingLevel : 0;
  return (skill ? base * 2 : base) * (100 + 10 * level + 20 * skillLevel + relicPercent) / 100;
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
 *
 * Границы недели — по поясу комнаты (`roomTimeZone`): у комнаты в Москве неделя кончается в 20:00 МСК.
 */
export async function goalProgress(
  db: Db,
  room: Room,
  now: Date,
  weekStart = latestDigestMoment(now, roomTimeZone(room)).at,
  userId?: number,
): Promise<GoalProgress> {
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
  return goalProgress(db, room, now, new Date(latestDigestMoment(now, roomTimeZone(room)).at.getTime() - WEEK_MS));
}

export async function setWeeklyGoal(db: Db, roomId: number, goal: number): Promise<void> {
  await db.update(rooms).set({ weeklyGoal: goal }).where(eq(rooms.id, roomId));
}

/**
 * Комнаты, которые только что выполнили цель недели; помечает, чтобы поздравить один раз.
 *
 * Ключ недели у каждой комнаты свой — по её поясу. Поэтому отбор идёт в памяти, а не одним `where` по
 * общему `week.date`: у комнаты в Москве и комнаты в Новосибирске это разные даты воскресенья, и общий
 * фильтр поздравил бы одну из них дважды либо не поздравил вовсе.
 */
export async function collectGoalsReached(db: Db, now: Date): Promise<Array<{ room: Room; progress: GoalProgress; date: string }>> {
  const result: Array<{ room: Room; progress: GoalProgress; date: string }> = [];
  for (const room of await db.select().from(rooms)) {
    const week = latestDigestMoment(now, roomTimeZone(room));
    if (room.goalReachedWeek === week.date) continue;
    const progress = await goalProgress(db, room, now, week.at);
    if (progress.done < progress.target) continue;
    // Не помечаем здесь: отметка после доставки (`markGoalReached`). Иначе сбой Telegram съедал
    // поздравление навсегда — неделя записана как поздравленная, а сообщения не было.
    result.push({ room, progress, date: week.date });
  }
  return result;
}

/** Отметить комнату поздравленной с целью недели. Ставится после доставки — см. `collectGoalsReached`. */
export async function markGoalReached(db: Db, roomId: number, date: string): Promise<void> {
  await db.update(rooms).set({ goalReachedWeek: date }).where(eq(rooms.id, roomId));
}
