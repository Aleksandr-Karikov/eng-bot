import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, users, words, type Room, type User } from "../db/schema";
import { DIGEST_TIME, FALLBACK_TZ, latestDigestMoment, roomTimeZone, WEEK_MS } from "./digest";
import { answerWeight, goalProgress, type GoalProgress } from "./goals";
import { availableRune, bossStrikes, mobClaims, withCombatLock } from "./combat-ledger";
import { MOBS } from "../combat-mobs";
import { localMoment } from "../time";

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

/**
 * Кто стоит на арене в этом раунде.
 *
 * Раньше неделя была одним боссом, и `weeklyOpponent` звался один раз. Теперь раундов в неделе может быть
 * несколько, и повторять подряд того же дракона с теми же HP — значит показывать «новый босс», который на
 * вид ничем не отличается от добитого. Поэтому противники чередуются от недели к неделе И от раунда к
 * раунду: первый раунд недели идёт от даты недели, второй сдвигает выбор на одного вперёд.
 */
export function roundOpponent(weekStart: Date, round = 1) {
  const weekIndex = Math.floor(weekStart.getTime() / WEEK_MS);
  return WEEKLY_BOSSES[(weekIndex + Math.max(0, round - 1)) % WEEKLY_BOSSES.length];
}

/** Противник первого раунда недели. Оставлено ради бонуса Дракона: он считается по неделе, не по раунду. */
export function weeklyOpponent(weekStart: Date) {
  return roundOpponent(weekStart, 1);
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
  /** Ступень ладдера (1…LADDER_TIERS) и круг: пройден весь ладдер — дальше следующий, сильнее. */
  tier: number;
  cycle: number;
  /**
   * HP текущего босса. Растёт с раундом, поэтому у второго он больше недельной цели `target`.
   * Полоску и «осталось» считать по нему; монеты, трофеи и дайджест — по `target`.
   */
  bossHp: number;
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
  /** Сколько HP у текущего босса: каждая ступень толще предыдущей. */
  hp: number;
  /** Ступень ладдера (1…LADDER_TIERS) и круг: пройден весь ладдер — начинается следующий, сильнее. */
  tier: number;
  cycle: number;
}

/** Ступеней в круге: пройдены все — начинается следующий круг, сильнее. */
export const LADDER_TIERS = 8;
/**
 * Рост HP внутри круга. Подобран под то, что прокачка ограничена ×2 (10 уровней по +10%):
 * при 1.35 стабильный игрок без прокачки берёт 3 босса, а на максимуме силы — 5. Круче (1.45) прокачка
 * перестаёт двигать глубину, мягче (1.15) — ладдер кончается за пару недель.
 */
const LADDER_GROWTH = 1.3;
/**
 * HP первой ступени — одно число для всех комнат и всех недель.
 *
 * Это и есть «одни и те же боссы каждую неделю»: лесенка не пересчитывается от прошлой активности, иначе
 * сильная комната получала бы более толстого первого босса и глубина не росла бы никогда (проверено
 * симуляцией: цель уезжала вверх быстрее, чем прокачка). Фиксированная база = фиксированная игра, а
 * глубина зависит только от силы комнаты — как в рогалике.
 *
 * 25 HP ≈ 12 ответов «Помню» за неделю — первый босс берётся почти сразу, чтобы новичок увидел победу.
 * Подобрано по симуляции двух режимов: новичок с двадцатью ответами проходит 1 → 2 босса по мере
 * прокачки, активный со ста — 4 → 6. Меньше база — ладдер кончается за пару недель, больше — новичок
 * застревает на первом боссе и не видит прогресса.
 */
export const LADDER_BASE_HP = 25;
/** Следующий круг целиком сильнее прошлого: пройденный ладдер не должен становиться копией. */
const CYCLE_GROWTH = 1.5;

/**
 * HP босса на ступени `tier` круга `cycle`.
 *
 * Ладдер фиксированный, а не пересчитываемый от прошлой недели: рогалик тем и интересен, что путь один
 * для всех, и глубина прохождения зависит только от силы комнаты. Поэтому у сильной комнаты первый босс
 * не становится толще — она просто доходит дальше по той же лесенке.
 */
export function tierHp(tier: number, cycle = 1, base: number = LADDER_BASE_HP): number {
  const inCycle = LADDER_GROWTH ** Math.max(0, tier - 1);
  const cycleBonus = CYCLE_GROWTH ** Math.max(0, cycle - 1);
  return Math.round(base * inCycle * cycleBonus * 10) / 10;
}

/** Сколько HP нужно снять, чтобы пройти `kills` боссов подряд, начиная с первой ступени. */
function ladderSpent(kills: number, base: number): number {
  let sum = 0;
  for (let i = 0; i < kills; i++) sum += tierHp((i % LADDER_TIERS) + 1, Math.floor(i / LADDER_TIERS) + 1, base);
  return sum;
}

/**
 * Где комната стоит на ладдере: сколько боссов добила, на какой ступени и что у текущего снято.
 *
 * `base` — обычный недельный урон комнаты без усилений (сколько HP она снимает за неделю). От него
 * считается вся лесенка, поэтому ладдер один на всех, а глубина — своя у каждой комнаты.
 *
 * HP растут геометрически, поэтому остаток считается по накопленной сумме ступеней, а не «kills × цель»:
 * иначе после второй ступени границы поехали бы.
 */
export function bossRound(done: number, base: number = LADDER_BASE_HP): BossRound {
  if (base <= 0) return { round: 1, kills: 0, progress: 0, hp: 0, tier: 1, cycle: 1 };
  let kills = 0;
  // Допуск в одну десятую HP: урон хранится десятыми, и без него погрешность сложения дала бы
  // «99.99999999999 вместо 100».
  while (kills < 10_000) {
    const next = ladderSpent(kills + 1, base);
    if (done + 0.05 < next) break;
    kills += 1;
  }
  const cycle = Math.floor(kills / LADDER_TIERS) + 1;
  const tier = (kills % LADDER_TIERS) + 1;
  const hp = tierHp(tier, cycle, base);
  const spent = ladderSpent(kills, base);
  const progress = Math.max(0, Math.round((done - spent) * 10) / 10);
  return { round: kills + 1, kills, progress, hp, tier, cycle };
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
  // База ладдера — цель комнаты, если её задали руками (/goal), иначе фиксированные LADDER_BASE_HP.
  // Автоцель сюда НЕ идёт: она считается от прошлой активности и растёт на 10% в неделю, то есть
  // база уезжала бы вверх вместе с прогрессом, и глубина не росла бы никогда. С фиксированной базой
  // боссы каждую неделю одни и те же, а доходить дальше позволяет прокачка — как в рогалике.
  const ladderBase = room.weeklyGoal > 0 ? room.weeklyGoal : LADDER_BASE_HP;
  const { round, kills, progress: current, hp: bossHp, tier, cycle } = bossRound(progress.done, ladderBase);
  const hp = Math.max(0, Math.round((bossHp - current) * 10) / 10);
  const damage = bossHp > 0 ? Math.min(1, current / bossHp) : 0;
  return {
    ...progress,
    room: room.name,
    // Свой противник у каждой ступени: второй босс недели — уже другой, а не тот же дракон.
    opponent: roundOpponent(weekStart, round),
    week,
    hp,
    damage,
    // Добитый босс сразу уступает место следующему, поэтому фаза считается по текущему раунду:
    // ровно `done === target` не наступает, вместо него начинается раунд 2.
    phase: bossPhase(damage, current, bossHp),
    pace: bossPace(progress.done, progress.target, elapsed),
    daysLeft: Math.max(0, Math.floor((end - now.getTime()) / DAY_MS)),
    timeZone,
    round,
    kills,
    progress: current,
    // HP текущего босса: у второй ступени он толще базы, и полоска должна показывать его, а не цель.
    // `target` при этом остаётся базой комнаты — на нём считаются монеты, трофеи и дайджест.
    bossHp,
    tier,
    cycle,
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

/**
 * Сколько монет стоит следующий уровень.
 *
 * Рост ×1.5, а не ×2: доход растёт линейно (монеты = недельный урон), поэтому удвоение цены делало
 * верхние уровни недостижимыми — на L10 требовалось бы 512 недель дохода, и «доходить дальше по ладдеру»
 * исчезло бы вместе с ними. При ×1.5 вся лестница (100…3844) проходится примерно за 57 недель дохода,
 * то есть за год игры, и каждый уровень по-прежнему заметен.
 */
export function upgradePrice(level: number): number {
  return Math.round(100 * 1.5 ** level);
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
export async function personalDamage(db: Db, userId: number, now: Date, period?: string): Promise<number> {
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const current = latestDigestMoment(now, user?.timezone ?? FALLBACK_TZ);
  // `period` — посчитать за конкретную (уже закрытую) неделю: нужно при переносе остатка в копилку.
  const closed = period !== undefined && period !== current.date;
  const week = closed
    ? { date: period, at: localMoment(user?.timezone ?? FALLBACK_TZ, period, DIGEST_TIME) }
    : current;
  const until = new Date(week.at.getTime() + WEEK_MS);
  const rows = await db.select().from(reviewLogs).where(and(
    eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, week.at),
    // Закрытая неделя — ровно её окно; текущая — от начала недели до сейчас.
    ...(closed ? [lt(reviewLogs.reviewedAt, until)] : []),
  ));
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
  Partial<Pick<User, "upgradeListen" | "upgradeWriting" | "timezone" | "coinsBankDeci">>;

/** Период кошелька — неделя по поясу человека; без него — общий запасной пояс. */
function walletPeriod(user: Pick<User, "coinsPeriod"> & Partial<Pick<User, "timezone">>, now: Date): string {
  return coinsPeriod(now, user.timezone ?? FALLBACK_TZ);
}

/**
 * Сколько монет доступно: копилка прошлых недель плюс не потраченное на этой.
 *
 * Раньше это был только остаток текущей недели, и после воскресенья он обнулялся. Теперь неизрасходованное
 * переезжает в копилку (`coinsBankDeci`), поэтому прокачка может копиться неделями — без этого ладдер
 * боссов не даёт «доходить дальше»: цена уровня растёт вдвое, а недельный доход нет.
 */
export function coinState(done: number, user: Wallet, now: Date): CoinState {
  const spent = user.coinsPeriod === walletPeriod(user, now) ? user.coinsSpent : 0;
  const bank = (user.coinsBankDeci ?? 0) / 10;
  const offers = UPGRADES.map(({ field, ...offer }) => {
    const level = user[field] ?? 0;
    return { ...offer, level, price: level < MAX_UPGRADE ? upgradePrice(level) : null };
  });
  return {
    coins: Math.max(0, Math.round((bank + done - spent) * 10) / 10),
    level: user.upgradeDamage,
    price: offers[0].price,
    offers,
  };
}

function walletSnapshot(user: Pick<User, "coinsSpent" | "coinsPeriod">) {
  return and(eq(users.coinsSpent, user.coinsSpent), user.coinsPeriod === null ? isNull(users.coinsPeriod) : eq(users.coinsPeriod, user.coinsPeriod));
}

/**
 * 🪙 Перенести непотраченный остаток недели в копилку.
 *
 * Зовётся из фонового цикла, когда неделя сменилась: остаток считался бы сгоревшим, а теперь переезжает
 * в `coinsBankDeci` и доступен для покупок в следующие недели. Без этого прокачка застывает — цена уровня
 * растёт вдвое, недельный доход нет, и ладдер боссов не даёт «доходить дальше».
 *
 * Идемпотентно: `coinsPeriod` ставится в текущую неделю, поэтому второй вызов в той же неделе ничего не
 * переносит — остаток уже обнулён и засчитан.
 */
/**
 * Копилка «на чтение»: если неделя сменилась, остаток прошлой уже должен быть в копилке.
 *
 * Ленивый вариант переноса — вызывается там, где кошелёк показывают или тратят. Фоновый тик для этого не
 * нужен и был бы хуже: он обходил бы всех пользователей каждую минуту ради события раз в неделю.
 */
export async function settledBank(db: Db, userId: number, now: Date): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return 0;
  const period = walletPeriod(user, now);
  if (user.coinsPeriod === period) return (user.coinsBankDeci ?? 0) / 10;
  // Неделя сменилась: считаем остаток ТОЙ недели и переносим.
  const closed = user.coinsPeriod == null ? 0 : await personalDamage(db, userId, now, user.coinsPeriod);
  await bankLeftoverCoins(db, userId, closed, now);
  const [fresh] = await db.select({ bank: users.coinsBankDeci }).from(users).where(eq(users.id, userId));
  return (fresh?.bank ?? 0) / 10;
}

export async function bankLeftoverCoins(db: Db, userId: number, done: number, now: Date): Promise<number> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return 0;
  const period = walletPeriod(user, now);
  // Неделя ещё та же — переносить нечего, остаток ещё может быть потрачен.
  if (user.coinsPeriod === period) return 0;
  const leftover = Math.max(0, Math.round(done * 10) - user.coinsSpent);
  if (leftover <= 0) {
    await db.update(users).set({ coinsSpent: 0, coinsPeriod: period }).where(eq(users.id, userId));
    return 0;
  }
  const updated = await db.update(users).set({
    coinsSpent: 0,
    coinsPeriod: period,
    coinsBankDeci: (user.coinsBankDeci ?? 0) + leftover,
  }).where(and(eq(users.id, userId), walletSnapshot(user))).returning({ id: users.id });
  return updated.length ? leftover / 10 : 0;
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
  // Цена сначала гасит недельный остаток, и только излишек — копилку. Для человека это выгодно:
  // недельный остаток иначе сгорел бы первым, а копилка осталась бы нетронутой.
  const period = walletPeriod(user, now);
  const spentThisWeek = user.coinsPeriod === period ? user.coinsSpent : 0;
  const weekLeft = Math.max(0, Math.round((done - spentThisWeek) * 10) / 10);
  const fromWeek = Math.min(weekLeft, offer.price);
  const fromBank = Math.round((offer.price - fromWeek) * 10);
  const updated = await db.update(users).set({
    [upgrade.field]: offer.level + 1,
    coinsSpent: spentThisWeek + fromWeek,
    coinsPeriod: period,
    coinsBankDeci: Math.max(0, (user.coinsBankDeci ?? 0) - fromBank),
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
    // Как и усиление: сначала недельный остаток, потом копилка.
    const spentThisWeek = user.coinsPeriod === period ? user.coinsSpent : 0;
    const weekLeft = Math.max(0, Math.round((done - spentThisWeek) * 10) / 10);
    const fromWeek = Math.min(weekLeft, RUNE_PRICE);
    const [updated] = await db.update(users).set({
      runesBought: user.runesBought + 1,
      coinsSpent: spentThisWeek + fromWeek,
      coinsPeriod: period,
      coinsBankDeci: Math.max(0, (user.coinsBankDeci ?? 0) - Math.round((RUNE_PRICE - fromWeek) * 10)),
    }).where(and(eq(users.id, userId), eq(users.runesBought, user.runesBought), walletSnapshot(user)))
      .returning({ id: users.id });
    return updated ? "ok" : "stale";
  });
}
