import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, users, words, type Room, type User } from "../db/schema";
import { FALLBACK_TZ, latestDigestMoment, roomTimeZone, WEEK_MS } from "./digest";
import { answerWeight, goalProgress, type GoalProgress } from "./goals";
import { availableRune, bossStrikes, mobClaims, withCombatLock } from "./combat-ledger";
import { MOBS } from "../combat-mobs";

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

export const WEEKLY_BOSSES = [
  { id: "dragon", name: "Дракон библиотеки" },
  { id: "sentinel", name: "Страж обсерватории" },
] as const;

export function weeklyOpponent(weekStart: Date) {
  return WEEKLY_BOSSES[Math.floor(weekStart.getTime() / WEEK_MS) % WEEKLY_BOSSES.length];
}

export interface BossState extends GoalProgress {
  room: string;
  opponent: (typeof WEEKLY_BOSSES)[number];
  week: string;
  /** Сколько HP осталось у ТЕКУЩЕГО босса; 0 не бывает — добитый сразу уступает место следующему. */
  hp: number;
  /** Доля снятого HP текущего босса: 0…1. Ровно 1 не держится: на добивании начинается новый раунд. */
  damage: number;
  phase: BossPhase;
  /** Успевает ли комната добить к концу недели при нынешнем темпе. */
  pace: BossPace;
  /** Полных дней до конца недели (0 — добивать сегодня). */
  daysLeft: number;
  /** Пояс комнаты: в нём кончается неделя и по нему подписывается время. */
  timeZone: string;
  /** Какой по счёту босс на этой неделе (1 — первый). */
  round: number;
  /** Сколько боссов комната уже добила за эту неделю. */
  kills: number;
  /** Урон, снятый с текущего босса. */
  progress: number;
}

/**
 * Фаза по доле снятого HP. Четыре ступени, а не десять: по полоске должно быть видно с одного взгляда,
 * и это же те четыре картинки, которые рисует вкладка.
 *
 * Границы такие, чтобы «злой» наступал не от первого ответа, а «в ярости» — не на самом финише,
 * когда успеть уже нельзя.
 *
 * `dead` остался ради совместимости и прямых вызовов, но в состоянии комнаты он больше не появляется:
 * добитый босс тут же уступает место следующему (см. `bossRound`).
 */
export function bossPhase(damage: number, done: number, target: number): BossPhase {
  if (done >= target) return "dead";
  if (damage >= 0.66) return "furious";
  if (damage >= 0.25) return "angry";
  return "fresh";
}

export interface BossRound {
  /** Номер босса на этой неделе, с единицы. */
  round: number;
  /** Сколько боссов комната уже добила за эту неделю. */
  kills: number;
  /** Урон по текущему боссу: сколько снято с него, а не за неделю. */
  progress: number;
}

/**
 * Какой по счёту босс сейчас на арене и сколько снято с него.
 *
 * Неделя — единица монет, трофеев и дайджеста, но не босса: комната, которая смела цель к среде, не должна
 * сидеть без боя до воскресенья. Поэтому урон недели нарезается на раунды по `target`, и каждый новый
 * раунд — новый босс с полным HP. Перебор засчитывается: добил с запасом — сразу несколько раундов.
 *
 * Дробные HP приходят десятыми, поэтому сравнение идёт с допуском: 99.9999 не должно давать «почти добит».
 */
export function bossRound(done: number, target: number): BossRound {
  if (target <= 0) return { round: 1, kills: 0, progress: 0 };
  // Допуск в одну десятую HP: урон хранится с точностью до десятых, и без него погрешность сложения
  // десяти чисел могла бы дать 99.99999999999 вместо 100.
  const kills = Math.floor((done + 0.05) / target);
  const progress = Math.max(0, Math.round((done - kills * target) * 10) / 10);
  return { round: kills + 1, kills, progress };
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

const DAY_MS = 24 * 60 * 60_000;

/**
 * Состояние босса комнаты на сейчас. Неделя — та же, что у цели комнаты: воскресенье 20:00 по её поясу.
 *
 * HP, фаза и темп — про ТЕКУЩЕГО босса, а не про неделю: недельный урон нарезан на раунды (`bossRound`),
 * поэтому комната, добившая цель в среду, в четверг получает следующего босса, а не пустой экран до
 * воскресенья. Недельные числа (`done`, `byUser`, `mine`) остаются недельными — на них считаются монеты,
 * трофеи и дайджест.
 */
export async function bossOf(db: Db, room: Room, now: Date, userId?: number): Promise<BossState> {
  const timeZone = roomTimeZone(room);
  const { date: week, at: weekStart } = latestDigestMoment(now, timeZone);
  const progress = await goalProgress(db, room, now, weekStart, userId);
  const end = weekStart.getTime() + WEEK_MS;
  const elapsed = (now.getTime() - weekStart.getTime()) / WEEK_MS;
  const { round, kills, progress: current } = bossRound(progress.done, progress.target);
  const hp = Math.max(0, Math.round((progress.target - current) * 10) / 10);
  const damage = progress.target > 0 ? Math.min(1, current / progress.target) : 0;
  return {
    ...progress,
    room: room.name,
    opponent: weeklyOpponent(weekStart),
    week,
    hp,
    damage,
    // Добитый босс сразу уступает место следующему, поэтому фаза считается по текущему раунду:
    // ровно `done === target` не наступает, вместо него начинается раунд 2.
    phase: bossPhase(damage, current, progress.target),
    pace: bossPace(progress.done, progress.target, elapsed),
    daysLeft: Math.max(0, Math.floor((end - now.getTime()) / DAY_MS)),
    timeZone,
    round,
    kills,
    progress: current,
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
  finalBlow?: { name: string; at: Date };
}

/**
 * Лента ударов: свежие ответы участников комнаты, склеенные в удары по минутам.
 *
 * Склеивание обязательно, иначе лента превращается в поток по одному ответу — «Александр нанёс 1 урона»
 * сорок раз подряд. Один человек, отвечающий подряд, — это одна серия, то есть один удар.
 * Границы серий считаются по времени: разрыв больше минуты — новый удар.
 */
export async function bossFeed(db: Db, room: Room, now: Date, limit = 20, target?: number): Promise<BossFeed> {
  const weekStart = latestDigestMoment(now, roomTimeZone(room)).at;
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const rows = await db
    .select({ name: users.firstName, userId: users.id, at: reviewLogs.reviewedAt, rating: reviewLogs.rating, stage: reviewLogs.stage, damageDeci: reviewLogs.damageDeci })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .innerJoin(users, eq(reviewLogs.userId, users.id))
    .where(and(eq(words.roomId, room.id), eq(reviewLogs.banked, false), gte(reviewLogs.reviewedAt, weekStart), lt(reviewLogs.reviewedAt, weekEnd)))
    .orderBy(asc(reviewLogs.reviewedAt), asc(reviewLogs.id));

  const byUser = new Map<number, { name: string; damage: number }>();
  const hits: BossHit[] = [];
  let lastUserId: number | undefined;
  let remaining = target === undefined ? Infinity : Math.round(target * 10);
  let finalBlow: BossFeed["finalBlow"];
  const events = [
    ...rows.map((row) => ({ ...row, damageDeci: row.damageDeci ?? Math.round(answerWeight(row.rating, row.stage) * 10) })),
    ...await bossStrikes(db, room.id, weekStart, weekEnd),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const row of events) {
    // Добиваний за неделю может быть несколько: каждый раз, когда урон переходит через target,
    // начинается следующий босс. `finalBlow` — последнее такое добивание, оно и есть «герой последнего боя».
    if (remaining > 0 && remaining <= row.damageDeci) {
      finalBlow = { name: row.name, at: row.at };
      remaining += Math.round((target ?? 0) * 10);
    }
    remaining -= row.damageDeci;
    const damage = row.damageDeci / 10;
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
    total: events.length,
    ...(finalBlow ? { finalBlow } : {}),
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

/**
 * Период личного кошелька — неделя по поясу **человека**, а не комнаты.
 *
 * Кошелёк общий для всех комнат, поэтому его граница обязана быть одна и та же, в какой бы комнате
 * человек ни находился. Если брать пояс комнаты, то переход между комнатами с разными поясами сменил бы
 * ключ периода, `coinsSpent` обнулился бы — и одни и те же монеты можно было бы потратить дважды.
 * Пояс человека стабилен, поэтому граница не двигается под ногами.
 */
export function coinsPeriod(now: Date, timeZone: string = FALLBACK_TZ): string {
  return latestDigestMoment(now, timeZone).date;
}

/**
 * Личные монеты общие для комнат: смена комнаты не меняет кошелёк.
 *
 * Неделя — по поясу человека, как и `coinsPeriod`: награды мобов и накопленный урон должны считаться в
 * том же окне, что и кошелёк, иначе покупка «теряет» часть монет на стыке поясов.
 */
export async function personalDamage(db: Db, userId: number, now: Date): Promise<number> {
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const week = latestDigestMoment(now, user?.timezone ?? FALLBACK_TZ);
  const rows = await db.select().from(reviewLogs).where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, week.at)));
  const claims = await mobClaims(db, userId, week.date);
  const rewards = MOBS.filter((mob) => claims.some((claim) => claim.target === mob.id)).reduce((sum, mob) => sum + mob.coins, 0);
  return rewards + rows.reduce((sum, r) => sum + (r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10)), 0) / 10;
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
export const RUNE_PRICE = 40;
type Wallet = Pick<User, "upgradeDamage" | "coinsSpent" | "coinsPeriod"> &
  Partial<Pick<User, "upgradeListen" | "upgradeWriting" | "timezone">>;

/** Период кошелька — неделя по поясу человека; без него — общий запасной пояс. */
function walletPeriod(user: Pick<User, "coinsPeriod"> & Partial<Pick<User, "timezone">>, now: Date): string {
  return coinsPeriod(now, user.timezone ?? FALLBACK_TZ);
}

export function coinState(done: number, user: Wallet, now: Date): CoinState {
  const spent = user.coinsPeriod === walletPeriod(user, now) ? user.coinsSpent : 0;
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

function walletSnapshot(user: Pick<User, "coinsSpent" | "coinsPeriod">) {
  return and(eq(users.coinsSpent, user.coinsSpent), user.coinsPeriod === null ? isNull(users.coinsPeriod) : eq(users.coinsPeriod, user.coinsPeriod));
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
    coinsSpent: (user.coinsPeriod === walletPeriod(user, now) ? user.coinsSpent : 0) + offer.price,
    coinsPeriod: walletPeriod(user, now),
  }).where(and(eq(users.id, userId), eq(users[upgrade.field], offer.level), walletSnapshot(user)))
    .returning({ id: users.id });
  return updated.length ? "ok" : "poor";
}

export function buyPiercingRune(db: Db, userId: number, now: () => Date): Promise<"ok" | "poor" | "owned" | "stale"> {
  return withCombatLock(db, async () => {
    const at = now();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.modeBoss) return "stale";
    if (await availableRune(db, user) !== null) return "owned";
    const period = walletPeriod(user, at);
    const done = await personalDamage(db, userId, at);
    if (coinState(done, user, at).coins < RUNE_PRICE) return "poor";
    const [updated] = await db.update(users).set({
      runesBought: user.runesBought + 1,
      coinsSpent: (user.coinsPeriod === period ? user.coinsSpent : 0) + RUNE_PRICE,
      coinsPeriod: period,
    }).where(and(eq(users.id, userId), eq(users.runesBought, user.runesBought), walletSnapshot(user)))
      .returning({ id: users.id });
    return updated ? "ok" : "stale";
  });
}
