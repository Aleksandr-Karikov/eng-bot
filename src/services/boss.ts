import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, users, words, type Room } from "../db/schema";
import { latestDigestMoment } from "./digest";
import { goalProgress, type GoalProgress } from "./goals";

/**
 * 🐉 Босс недели — это цель комнаты, показанная как бой.
 *
 * Никаких очков, тапов и второй экономики: HP босса — `target` цели, урон — `done`, то есть обычные
 * повторения. Поэтому `bossOf` не считает ничего своего, а читает `goalProgress` (services/goals.ts).
 * Это главное свойство режима: включил — видно бой, выключил — остались те же числа в /goal.
 */

export const BOSS_PHASES = ["fresh", "angry", "furious", "dead"] as const;
export type BossPhase = (typeof BOSS_PHASES)[number];

export type BossPace = "ahead" | "on-time" | "behind";

export interface BossState extends GoalProgress {
  room: string;
  /** Сколько HP осталось; больше нуля всегда, пока цель не выполнена. */
  hp: number;
  /** Доля снятого HP: 0…1, больше 1 — добит с запасом. */
  damage: number;
  phase: BossPhase;
  /** Успевает ли комната добить к концу недели при нынешнем темпе. */
  pace: BossPace;
  /** Полных дней до конца недели (0 — добивать сегодня). */
  daysLeft: number;
}

/**
 * Фаза по доле снятого HP. Четыре ступени, а не десять: по полоске должно быть видно с одного взгляда,
 * и это же те четыре картинки, которые рисует вкладка.
 *
 * Границы такие, чтобы «злой» наступал не от первого ответа, а «в ярости» — не на самом финише,
 * когда успеть уже нельзя.
 */
export function bossPhase(damage: number, done: number, target: number): BossPhase {
  if (done >= target) return "dead";
  if (damage >= 0.66) return "furious";
  if (damage >= 0.25) return "angry";
  return "fresh";
}

/**
 * Темп: успеем ли. Сравниваем не «сколько сделано», а «сколько должно было бы быть к этому моменту» —
 * иначе в понедельник все всегда отстают, а в воскресенье все всегда успевают.
 *
 * Допуск — 10% цели: дрожать за каждый ответ не нужно, «в темпе» это широкий коридор.
 */
export function bossPace(done: number, target: number, elapsed: number): BossPace {
  const expected = target * Math.min(1, Math.max(0, elapsed));
  const margin = Math.max(1, target * 0.1);
  if (done >= expected + margin) return "ahead";
  if (done >= expected - margin) return "on-time";
  return "behind";
}

const WEEK_MS = 7 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Состояние босса комнаты на сейчас. Неделя — та же, что у цели комнаты (воскресенье 20:00). */
export async function bossOf(db: Db, room: Room, now: Date): Promise<BossState> {
  const weekStart = latestDigestMoment(now).at;
  const progress = await goalProgress(db, room, now, weekStart);
  const end = weekStart.getTime() + WEEK_MS;
  const elapsed = (now.getTime() - weekStart.getTime()) / WEEK_MS;
  const damage = progress.target > 0 ? progress.done / progress.target : 0;
  return {
    ...progress,
    room: room.name,
    hp: Math.max(0, progress.target - progress.done),
    damage,
    phase: bossPhase(damage, progress.done, progress.target),
    pace: bossPace(progress.done, progress.target, elapsed),
    daysLeft: Math.max(0, Math.floor((end - now.getTime()) / DAY_MS)),
  };
}

/**
 * Видит ли человек босса. Два условия сразу:
 *
 * - личный режим (`users.mode_boss`) — в одной комнате двое могут хотеть разного, и выключать игру
 *   соседу из-за своего вкуса не дело;
 * - общий рубильник (`BOSS_ENABLED` в .env, он же `deps.bossEnabled`) — выключает режим всем и сразу.
 *
 * Личную настройку рубильник не трогает: вернули BOSS_ENABLED=1 — у каждого снова как было, и никому
 * не придётся заново включать. Это и есть обратимость без последствий.
 */
export function bossEnabled(user: { modeBoss: boolean }, globalEnabled: boolean | undefined): boolean {
  return globalEnabled !== false && user.modeBoss;
}

/** Один удар — сколько повторений сделал человек за раз. */
export interface BossHit {
  name: string;
  /** Сколько ответов в этом ударе (для «нанёс 12 урона»). */
  damage: number;
  at: Date;
  /** Своя ли это отметка: своё в ленте не новость, но полезно знать, что удар засчитан. */
  own: boolean;
}

export interface BossFeed {
  hits: BossHit[];
  /** Кто сколько снял с босса за неделю, больше — выше. */
  byUser: Array<{ name: string; damage: number }>;
  /** Сколько всего ударов за неделю (для «бот пропустил 40 ударов, пока ты не смотрел»). */
  total: number;
}

/**
 * Лента ударов: свежие ответы участников комнаты, склеенные в удары по минутам.
 *
 * Склеивание обязательно, иначе лента превращается в поток по одному ответу — «Александр нанёс 1 урона»
 * сорок раз подряд. Один человек, отвечающий подряд, — это одна серия, то есть один удар.
 * Границы серий считаются по времени: разрыв больше минуты — новый удар.
 */
export async function bossFeed(db: Db, room: Room, now: Date, limit = 20): Promise<BossFeed> {
  const weekStart = latestDigestMoment(now).at;
  const rows = await db
    .select({ name: users.firstName, userId: users.id, at: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, room.id), gte(reviewLogs.reviewedAt, weekStart)))
    .orderBy(asc(reviewLogs.reviewedAt));

  const byUser = new Map<number, { name: string; damage: number }>();
  const hits: BossHit[] = [];
  for (const row of rows) {
    const total = byUser.get(row.userId) ?? { name: row.name, damage: 0 };
    total.damage++;
    byUser.set(row.userId, total);

    const last = hits.at(-1);
    // Та же серия: тот же человек и разрыв меньше минуты — удар растёт, а не добавляется новый.
    if (last && last.name === row.name && row.at.getTime() - last.at.getTime() <= SAME_HIT_MS) {
      last.damage++;
      last.at = row.at;
    } else {
      hits.push({ name: row.name, damage: 1, at: row.at, own: false });
    }
  }
  return {
    hits: hits.slice(-limit).reverse(),
    byUser: [...byUser.values()].sort((a, b) => b.damage - a.damage),
    total: rows.length,
  };
}

/** Разрыв, после которого удар считается новым. */
const SAME_HIT_MS = 60_000;

/** PHASE → подпись босса: он живой, а не просто полоска. */
export const BOSS_TITLES: Record<BossPhase, string> = {
  fresh: "Босс спокоен",
  angry: "Босс злится",
  furious: "Босс в ярости",
  dead: "Босс повержен",
};
