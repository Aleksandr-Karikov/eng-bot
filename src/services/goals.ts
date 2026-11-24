import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, rooms, users, words, type Room } from "../db/schema";
import { latestDigestMoment, roomTimeZone, WEEK_MS } from "./digest";
import { bossStrikes } from "./combat-ledger";

/**
 * Цель недели по умолчанию — фиксированная, 100 HP.
 *
 * Раньше она считалась от числа ответов прошлой недели (`autoGoal(raw) × BASE_WEIGHT`), и это ломало игру
 * с двух сторон. Усиление поднимает урон за ответ, поэтому для той же цели нужно меньше ответов: `raw`
 * падал, и следующая цель становилась МЕНЬШЕ — человек не «доходил дальше», а откатывался (E3). А `raw`
 * считал все ответы подряд, включая «Забыл», то есть честность повышала цель следующей недели (E4).
 *
 * Теперь цель одна для всех и не зависит ни от прокачки, ни от прошлой недели. Глубину даёт ладдер
 * боссов (`LADDER_BASE_HP`, `tierHp`): база фиксирована, а доходить дальше позволяет прокачка — как
 * в рогалике. 100 HP ≈ 50 ответов «Помню»; это ровно то число, с которого в проде активная комната
 * добивала босса, а не упиралась в 2220–3980 HP, которые давала прежняя формула.
 */
export const DEFAULT_GOAL_HP = 100;

export interface GoalProgress {
  target: number;
  done: number;
  /** Урон конкретного человека, если спросили про него: на нём считаются монеты (усиление личное). */
  mine?: number;
  /** Цель не задана руками — действует общая `DEFAULT_GOAL_HP`. */
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
 * Множитель урона за «Забыл» по счёту подряд: 1 → 0.5 → 0.25 → 0.
 *
 * Первый провал стоит полного урона: признаться честно всё ещё выгодно. Дальше цена падает, потому что
 * FSRS возвращает такую карточку через минуту — повторные нажатия «Забыл» не показывают память, а
 * прокручивают одну карточку. С четвёртого подряд урон нулевой: до повторения с интервалом дело так и
 * не дошло, значит и работы не было.
 */
export function againDecay(streak: number): number {
  if (streak <= 1) return 1;
  if (streak === 2) return 0.5;
  if (streak === 3) return 0.25;
  return 0;
}

/**
 * Сколько раз подряд эта карточка получала «Забыл», включая текущий ответ.
 *
 * Считается по `review_logs`: последние ответы по карточке, подряд идущие `again`. Новой таблицы не
 * нужно — история уже есть, и она переживает перезапуск. `rating != 'again'` обрывает серию, потому что
 * тогда интервал вырос и следующее «Забыл» снова первый провал.
 */
export async function againStreak(db: Db, cardId: number, now: Date, limit = 3): Promise<number> {
  const rows = await db
    .select({ rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.cardId, cardId), lt(reviewLogs.reviewedAt, now)))
    .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
    .limit(limit);
  let streak = 0;
  for (const row of rows) {
    if (row.rating !== "again") break;
    streak += 1;
  }
  return streak + 1;
}

/** Стадия «уже знаю»: знакомство с чужим словом, а не проверка памяти (E5). */
export const KNOW_STAGE = "know";

/**
 * Вес ответа в HP. «Забыл» — тоже 1, а не 0: ноль наказывал бы за честность, и стало бы выгодно
 * врать себе «помню», чтобы босс дох. Признался — уже работа.
 *
 * Но за серию «Забыл» подряд урон падает (`againDecay`): FSRS возвращает такую карточку через минуту,
 * и без затухания одна карточка кормит босса бесконечно, награждая нажатия вместо памяти (E2).
 * `againStreak` — который это «Забыл» подряд по этой карточке, начиная с 1.
 *
 * «Уже знаю» не даёт урона вовсе: это свайп «слово знакомо», без единого вопроса, и раньше он давал
 * максимум базовой таблицы (3 HP за `easy`) за нажатие — больше, чем «Помню» после раздумий.
 * Карточка при этом закрывается как обычно: знакомство засчитывается, вклад в цель — нет (E5).
 */
export function answerWeight(rating: string, stage?: string | null, level = 0, listenLevel = 0, writingLevel = 0, relicPercent = 0, againStreak = 1): number {
  if (stage === KNOW_STAGE) return 0;
  const base = rating === "easy" ? 3 : rating === "hard" ? 2 : rating === "good" ? 2 : 1;
  const decay = rating === "again" ? againDecay(againStreak) : 1;
  // Сложное упражнение — вдвое: человек не узнал слово, а воспроизвёл.
  const skill = damageSkill(stage);
  // +10% за уровень усиления — личное, поэтому применяется к своим ответам, а не к комнате целиком.
  const skillLevel = skill === "listen" ? listenLevel : skill === "writing" ? writingLevel : 0;
  return (skill ? base * 2 : base) * decay * (100 + 10 * level + 20 * skillLevel + relicPercent) / 100;
}

/**
 * Урон комнаты в [from, to) по участникам: HP, уже с усилением на момент ответа.
 *
 * Считаем по userId, а не по имени: усиление личное, поэтому урон каждого свой, и два тёзки в одной
 * комнате не должны сливаться в одного — раньше сливались, хотя вклад в цель это искажало.
 *
 * Сырого числа ответов здесь нет намеренно: цель недели от него больше не зависит (E3, E4), и держать
 * неиспользуемый счётчик значило бы оставить вход, через который связь вернётся.
 */
async function roomReviews(db: Db, roomId: number, from: Date, to: Date) {
  const rows = await db
    .select({ userId: users.id, name: users.firstName, rating: reviewLogs.rating, stage: reviewLogs.stage, damageDeci: reviewLogs.damageDeci, banked: reviewLogs.banked })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, roomId), gte(reviewLogs.reviewedAt, from), lt(reviewLogs.reviewedAt, to)));
  const hp = new Map<number, number>();
  const names = new Map<number, string>();
  for (const r of rows) {
    names.set(r.userId, r.name);
    if (!r.banked) hp.set(r.userId, (hp.get(r.userId) ?? 0) + (r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10)));
  }
  return { hp, names };
}

const total = (m: Map<number, number>) => Math.round([...m.values()].reduce((a, b) => a + b, 0) * 10) / 10;

/**
 * Цель недели в HP — только из явной настройки комнаты, иначе `DEFAULT_GOAL_HP`.
 *
 * Прошлая неделя в расчёт не входит вовсе: иначе прокачка сжимала бы следующую цель (E3), а честные
 * «Забыл» её раздували бы (E4). Число одно для всех комнат, и это то же число, что база ладдера боссов,
 * поэтому `/goal` и `/boss` показывают согласованные величины.
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
  // Цель — в HP и хранится в HP: одно число в /goal, дайджесте и на вкладке босса.
  // Прошлую неделю не читаем вовсе — см. DEFAULT_GOAL_HP.
  const target = room.weeklyGoal > 0 ? room.weeklyGoal : DEFAULT_GOAL_HP;
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
