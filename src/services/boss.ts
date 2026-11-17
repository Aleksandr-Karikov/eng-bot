import { and, asc, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, users, words, type Room, type User } from "../db/schema";
import { latestDigestMoment } from "./digest";
import { answerWeight, goalProgress, type GoalProgress } from "./goals";

/**
 * 🐉 Босс недели — это цель комнаты, показанная как бой.
 *
 * HP босса — `target` цели, урон — `done`: взвешенные ответы с усилением на момент ответа.
 * `bossOf` читает тот же `goalProgress`, что и /goal. Монеты — личный урон за вычетом трат.
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
export async function bossOf(db: Db, room: Room, now: Date, userId?: number): Promise<BossState> {
  const weekStart = latestDigestMoment(now).at;
  const progress = await goalProgress(db, room, now, weekStart, userId);
  const end = weekStart.getTime() + WEEK_MS;
  const elapsed = (now.getTime() - weekStart.getTime()) / WEEK_MS;
  const damage = progress.target > 0 ? progress.done / progress.target : 0;
  return {
    ...progress,
    room: room.name,
    hp: Math.max(0, Math.round((progress.target - progress.done) * 10) / 10),
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
  /** Суммарный урон серии в HP. */
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
    .select({ name: users.firstName, userId: users.id, at: reviewLogs.reviewedAt, rating: reviewLogs.rating, stage: reviewLogs.stage, damageDeci: reviewLogs.damageDeci })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, room.id), gte(reviewLogs.reviewedAt, weekStart)))
    .orderBy(asc(reviewLogs.reviewedAt));

  const byUser = new Map<number, { name: string; damage: number }>();
  const hits: BossHit[] = [];
  let lastUserId: number | undefined;
  for (const row of rows) {
    const damage = (row.damageDeci ?? Math.round(answerWeight(row.rating, row.stage) * 10)) / 10;
    const total = byUser.get(row.userId) ?? { name: row.name, damage: 0 };
    total.damage = Math.round((total.damage + damage) * 10) / 10;
    byUser.set(row.userId, total);

    const last = hits.at(-1);
    // Та же серия: тот же человек и разрыв меньше минуты — удар растёт, а не добавляется новый.
    if (last && lastUserId === row.userId && row.at.getTime() - last.at.getTime() <= SAME_HIT_MS) {
      last.damage = Math.round((last.damage + damage) * 10) / 10;
      last.at = row.at;
    } else {
      hits.push({ name: row.name, damage, at: row.at, own: false });
    }
    lastUserId = row.userId;
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

/**
 * 🪙 Монеты и усиление.
 *
 * Монеты — это нанесённый урон: не отдельный счётчик, а то же число. Поэтому они не конкурируют
 * с весами (диктант даёт больше и урона, и монет) и не дают второго способа получить силу.
 *
 * Тратятся на уровни усиления: каждый +10% к урону навсегда. Монеты недели сгорают в воскресенье —
 * копилки нет, иначе игра превращается в накопление.
 */

/** Сколько монет стоит следующий уровень. Дорожает: 100, 200, 400… */
export function upgradePrice(level: number): number {
  return 100 * 2 ** level;
}

/** Урон с учётом уровня: +10% за уровень. */
export function boostedDamage(hp: number, level: number): number {
  return Math.round(hp * (10 + level)) / 10;
}

/** Период монет — неделя комнаты (дата воскресенья), чтобы сгорание совпало со сменой босса. */
export function coinsPeriod(now: Date): string {
  return latestDigestMoment(now).date;
}

/** Личные монеты общие для комнат: смена комнаты не меняет кошелёк. */
export async function personalDamage(db: Db, userId: number, now: Date): Promise<number> {
  const rows = await db.select().from(reviewLogs).where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, latestDigestMoment(now).at)));
  return rows.reduce((sum, r) => sum + (r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10)), 0) / 10;
}

export const UPGRADES = [
  { kind: "damage", field: "upgradeDamage", title: "⚔️ Сила", description: "+10% базового урона всех ответов за уровень", bonus: 10 },
  { kind: "listen", field: "upgradeListen", title: "🎧 Слух", description: "+20% базового урона диктантов за уровень", bonus: 20 },
  { kind: "writing", field: "upgradeWriting", title: "✍️ Письмо", description: "+20% базового урона пропусков и своих предложений за уровень", bonus: 20 },
] as const;
export type UpgradeKind = typeof UPGRADES[number]["kind"];

export interface CoinState {
  coins: number;
  /** Сила: прежние поля оставлены для /upgrade и старых клиентов. */
  level: number;
  price: number | null;
  offers: Array<{ kind: UpgradeKind; title: string; description: string; bonus: number; level: number; price: number | null }>;
}

export const MAX_UPGRADE = 10;
type Wallet = Pick<User, "upgradeDamage" | "coinsSpent" | "coinsPeriod"> & Partial<Pick<User, "upgradeListen" | "upgradeWriting">>;

export function coinState(done: number, user: Wallet, now: Date): CoinState {
  const spent = user.coinsPeriod === coinsPeriod(now) ? user.coinsSpent : 0;
  const offers = UPGRADES.map(({ field, ...offer }) => {
    const level = user[field] ?? 0;
    return { ...offer, level, price: level < MAX_UPGRADE ? upgradePrice(level) : null };
  });
  return {
    coins: Math.max(0, Math.round((done - spent) * 10) / 10),
    level: user.upgradeDamage,
    price: offers[0].price,
    offers,
  };
}

/** Условное обновление общего кошелька не даёт двум покупкам потратить одни монеты. */
export async function buyUpgrade(db: Db, userId: number, done: number, now: Date, kind: UpgradeKind = "damage"): Promise<"ok" | "poor" | "max"> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return "poor";
  const upgrade = UPGRADES.find((u) => u.kind === kind);
  if (!upgrade) return "poor";
  const state = coinState(done, user, now);
  const offer = state.offers.find((o) => o.kind === kind)!;
  if (offer.price === null) return "max";
  if (state.coins < offer.price) return "poor";
  const updated = await db.update(users).set({
    [upgrade.field]: offer.level + 1,
    coinsSpent: (user.coinsPeriod === coinsPeriod(now) ? user.coinsSpent : 0) + offer.price,
    coinsPeriod: coinsPeriod(now),
  }).where(and(eq(users.id, userId), eq(users[upgrade.field], offer.level), eq(users.coinsSpent, user.coinsSpent)))
    .returning({ id: users.id });
  return updated.length ? "ok" : "poor";
}
