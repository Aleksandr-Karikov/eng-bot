import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, rooms, roomMembers, trophies, users, words, type Room, type User } from "../db/schema";
import { latestDigestMoment, WEEK_MS } from "./digest";
import { localParts } from "../time";
import { answerWeight, goalProgress } from "./goals";

/**
 * 🏆 Трофеи недели.
 *
 * Правила, из которых всё следует:
 *
 * 1. Трофей — следствие обычной тренировки, а не отдельное действие. Ничего не награждается за «зайди».
 * 2. Трофей проверяется по данным, которые уже пишутся: review_logs, word_uses, mistakes, duel_points.
 * 3. «Мемные» трофеи одноразовые. Иначе «Пацифист» выдаётся каждую неделю тому, кто бросил играть,
 *    и превращается из шутки в поощрение.
 * 4. Комнатные трофеи (больше всех, меньше всех) требуют 2+ участников: в личном словаре сравнивать не с кем.
 *
 * Выдаются раз в неделю, в воскресенье вместе с дайджестом — когда неделя закрыта и считать есть что.
 */

/** Как часто выдаётся трофей: раз в жизни или каждую неделю. */
export type TrophyRepeat = "once" | "weekly";

export interface TrophyDef {
  kind: string;
  emoji: string;
  title: string;
  /** Условие словами — показывается в коллекции, чтобы было видно, как получить. */
  how: string;
  repeat: TrophyRepeat;
  /** Нужна комната с 2+ участниками: «больше всех» среди одного себя бессмысленно. */
  needsCompany?: boolean;
}

export const TROPHIES: TrophyDef[] = [
  // ⚔️ Боевые
  { kind: "killer", emoji: "💀", title: "Добил", how: "твой ответ снял последние HP босса", repeat: "weekly" },
  { kind: "oneshot", emoji: "⚡", title: "Ваншот", how: "добил босса, у которого оставалось ≤10 HP", repeat: "weekly" },
  { kind: "overkill", emoji: "🔥", title: "С запасом", how: "урон ≥150% цели недели", repeat: "weekly" },
  { kind: "last-hour", emoji: "⏰", title: "В последний час", how: "босс добит за ≤3 часа до конца недели", repeat: "weekly" },
  { kind: "top", emoji: "👑", title: "Больше всех", how: "первый по урону в комнате", repeat: "weekly", needsCompany: true },
  { kind: "almost", emoji: "🥈", title: "Почти", how: "второе место, отставание ≤5%", repeat: "weekly", needsCompany: true },

  // 🃏 Мемные — все одноразовые
  { kind: "pacifist", emoji: "🕊", title: "Пацифист", how: "меньше всех урона в комнате, но бил", repeat: "once", needsCompany: true },
  { kind: "carried", emoji: "🛌", title: "Тебя протащили", how: "сам не бил, а комнату добили", repeat: "once", needsCompany: true },
  { kind: "night", emoji: "🌙", title: "Ночной охотник", how: "≥30% ответов между 00:00 и 05:00", repeat: "once" },
  { kind: "forgetful", emoji: "😭", title: "Забывчивый", how: "больше всех «Забыл» в комнате", repeat: "once", needsCompany: true },

  // 💪 Упорство
  { kind: "iron-week", emoji: "🔥", title: "Железная неделя", how: "отвечал все 7 дней без пропуска", repeat: "weekly" },
  { kind: "early-bird", emoji: "🌅", title: "Ранняя птица", how: "≥50% ответов до 9 утра", repeat: "weekly" },

  // 🎓 Умения
  { kind: "listener", emoji: "🎧", title: "На слух", how: "≥20 диктантов за неделю", repeat: "weekly" },
  { kind: "writer", emoji: "✍️", title: "Писатель", how: "≥10 своих предложений за неделю", repeat: "weekly" },
  { kind: "sniper", emoji: "🎯", title: "Снайпер", how: "точность ≥90% при ≥100 ответах", repeat: "weekly" },
];

export const TROPHY_BY_KIND = new Map(TROPHIES.map((t) => [t.kind, t]));

const HOUR_MS = 60 * 60_000;
/** Пояс, в котором считаются «ночь» и «утро»: тот же, что у недели и дайджеста. */
const TROPHY_TZ = "Asia/Novosibirsk";
const hourIn = (at: Date) => Number(localParts(TROPHY_TZ, at).time.slice(0, 2));

/** Ключ недели — дата воскресенья, как у цели и дайджеста. */
export const weekKey = (now: Date): string => latestDigestMoment(now).date;

/** Найденный трофей до записи в базу. */
export interface FoundTrophy {
  kind: string;
  value: number;
}

export interface WeekFacts {
  week: string;
  room: Room;
  /** Урон каждого участника: userId → HP. */
  damage: Map<number, number>;
  /** Сырые ответы каждого: для «Железной недели» и точности. */
  answers: Map<number, Array<{ rating: string; stage: string | null; at: Date }>>;
  /** Кто добил босса и когда. */
  killer?: number;
  killedAt?: Date;
  hpBeforeKill?: number;
  target: number;
  done: number;
  members: number;
}

/** Собираем всё, что нужно трофеям за одну неделю, одним проходом по данным комнаты. */
export async function weekFacts(db: Db, room: Room, now: Date): Promise<WeekFacts> {
  const week = latestDigestMoment(now);
  const end = week.at;
  const start = new Date(end.getTime() - WEEK_MS);
  const progress = await goalProgress(db, room, now, start);
  const rows = await db
    .select({ userId: reviewLogs.userId, rating: reviewLogs.rating, stage: reviewLogs.stage, at: reviewLogs.reviewedAt, damageDeci: reviewLogs.damageDeci })
    .from(reviewLogs)
    .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(words.roomId, room.id), gte(reviewLogs.reviewedAt, start), lt(reviewLogs.reviewedAt, end)))
    .orderBy(asc(reviewLogs.reviewedAt), asc(reviewLogs.id));

  const answers = new Map<number, Array<{ rating: string; stage: string | null; at: Date }>>();
  for (const r of rows) {
    const list = answers.get(r.userId) ?? [];
    list.push({ rating: r.rating, stage: r.stage, at: r.at });
    answers.set(r.userId, list);
  }
  const damage = new Map<number, number>();
  for (const r of rows) {
    damage.set(r.userId, (damage.get(r.userId) ?? 0) + (r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10)));
  }
  for (const [id, deci] of damage) damage.set(id, deci / 10);
  // Кто добил: последний ответ, после которого цель была пройдена. Считаем накопительно.
  let sum = 0;
  let killer: number | undefined;
  let killedAt: Date | undefined;
  let hpBeforeKill: number | undefined;
  for (const r of rows) {
    const before = progress.target - sum / 10;
    sum += r.damageDeci ?? Math.round(answerWeight(r.rating, r.stage) * 10);
    if (sum >= progress.target * 10 && killer === undefined) {
      hpBeforeKill = before;
      killer = r.userId;
      killedAt = r.at;
    }
  }
  return {
    week: week.date,
    room,
    damage,
    answers,
    killer,
    killedAt,
    hpBeforeKill,
    target: progress.target,
    done: progress.done,
    members: (await db.select().from(roomMembers).where(eq(roomMembers.roomId, room.id))).length,
  };
}

/** Трофеи одного человека за закрытую неделю. Чистая функция — тестируется без базы. */
export function trophiesFor(facts: WeekFacts, userId: number, alreadyOnce: Set<string>): FoundTrophy[] {
  const mine = facts.damage.get(userId) ?? 0;
  const mineAnswers = facts.answers.get(userId) ?? [];
  const found: FoundTrophy[] = [];
  const add = (kind: string, value = mine) => {
    const def = TROPHY_BY_KIND.get(kind);
    if (!def) return;
    if (def.needsCompany && facts.members < 2) return;
    // Одноразовый трофей второй раз не выдаём — ни в этом сезоне, ни в прошлом.
    if (def.repeat === "once" && alreadyOnce.has(kind)) return;
    found.push({ kind, value });
  };

  if (mineAnswers.length === 0) {
    // 🛌 «Тебя протащили» и 🪑 «Скамейка» — про тех, кто не пришёл, но это разные шутки.
    if (facts.members >= 2 && facts.killer !== undefined && facts.killer !== userId) add("carried", 0);
    return found;
  }

  const others = [...facts.damage.entries()].filter(([id]) => id !== userId);
  const othersMax = Math.max(0, ...others.map(([, hp]) => hp));
  const othersMin = others.length ? Math.min(...others.map(([, hp]) => hp)) : 0;
  const total = facts.done;

  // ⚔️ Боевые
  if (facts.killer === userId) add("killer");
  // ⏰ Добил в последние три часа недели.
  if (facts.killedAt && facts.killer === userId && closeToEnd(facts.killedAt, facts.week)) add("last-hour");
  // ⚡ Мой удар добил босса, у которого оставалось не больше 10 HP.
  if (facts.killer === userId && facts.hpBeforeKill !== undefined && facts.hpBeforeKill <= 10) add("oneshot");
  // 🔥 Комната смела босса с запасом.
  if (total >= facts.target * 1.5) add("overkill");

  if (others.length) {
    if (mine > othersMax) add("top");
    else if (others.filter(([, hp]) => hp > mine).length === 1 && othersMax - mine <= othersMax * 0.05) add("almost");
    // 🕊 Пацифист: меньше всех, но бил — шутка для того, кто еле приложился.
    if (mine < othersMin && mine > 0) add("pacifist");
    // 😭 Забывчивый: больше всех «Забыл».
    const forgot = (id: number) => (facts.answers.get(id) ?? []).filter((a) => a.rating === "again").length;
    if (forgot(userId) > Math.max(...others.map(([id]) => forgot(id)))) add("forgetful", forgot(userId));
  }

  // 🌙 Ночной охотник: треть ответов после полуночи.
  const night = mineAnswers.filter((a) => hourIn(a.at) < 5).length;
  if (mineAnswers.length >= 10 && night / mineAnswers.length >= 0.3) add("night", night);

  // 💪 Упорство
  const days = new Set(mineAnswers.map((a) => new Date(`${localParts(TROPHY_TZ, a.at).date}T12:00:00Z`).getUTCDay()));
  if (days.size === 7) add("iron-week", 7);
  const morning = mineAnswers.filter((a) => hourIn(a.at) < 9).length;
  if (mineAnswers.length >= 10 && morning / mineAnswers.length >= 0.5) add("early-bird", morning);

  // 🎓 Умения
  const staged = (s: string[]) => mineAnswers.filter((a) => a.stage !== null && s.includes(a.stage)).length;
  if (staged(["listen", "app_listen"]) >= 20) add("listener", staged(["listen", "app_listen"]));
  if (staged(["sentence", "app_sentence"]) >= 10) add("writer", staged(["sentence", "app_sentence"]));
  const good = mineAnswers.filter((a) => a.rating !== "again").length;
  if (mineAnswers.length >= 100 && good / mineAnswers.length >= 0.9) add("sniper", mineAnswers.length);

  return found;
}

/** Добит ли босс в последние три часа недели. */
function closeToEnd(killedAt: Date, week: string): boolean {
  return new Date(`${week}T20:00:00+07:00`).getTime() - killedAt.getTime() <= 3 * HOUR_MS;
}

/**
 * Выдать трофеи за только что закрытую неделю во всех комнатах.
 * Идемпотентно: уникальный индекс (userId, kind, week) не даёт выдать дважды.
 */
export async function collectTrophies(db: Db, now: Date, options: { dryRun?: boolean; weeklyOnly?: boolean } = {}): Promise<Array<{ user: User; earned: TrophyDef[] }>> {
  const week = weekKey(now);
  const already = await db.select({ userId: trophies.userId, kind: trophies.kind, week: trophies.week }).from(trophies);
  const onceHad = new Map<number, Set<string>>();
  for (const row of already) {
    const set = onceHad.get(row.userId) ?? new Set<string>();
    set.add(row.kind);
    onceHad.set(row.userId, set);
  }
  const weeksThis = new Set(already.filter((r) => r.week === week).map((r) => `${r.userId}:${r.kind}`));

  const result: Array<{ user: User; earned: TrophyDef[] }> = [];
  for (const room of await db.select().from(rooms)) {
    const facts = await weekFacts(db, room, now);
    if (facts.done === 0) continue;
    const members = await db.select({ userId: roomMembers.userId }).from(roomMembers).where(eq(roomMembers.roomId, room.id));
    for (const userId of new Set([...facts.damage.keys(), ...members.map((m) => m.userId)])) {
      const fresh = trophiesFor(facts, userId, onceHad.get(userId) ?? new Set()).filter((t) => !weeksThis.has(`${userId}:${t.kind}`) && (!options.weeklyOnly || TROPHY_BY_KIND.get(t.kind)?.repeat === "weekly"));
      if (fresh.length === 0) continue;
      for (const t of fresh) {
        weeksThis.add(`${userId}:${t.kind}`);
        if (TROPHY_BY_KIND.get(t.kind)?.repeat === "once") {
          const had = onceHad.get(userId) ?? new Set<string>();
          had.add(t.kind);
          onceHad.set(userId, had);
        }
        if (options.dryRun) continue;
        await db
          .insert(trophies)
          .values({ userId, kind: t.kind, week, roomId: room.id, roomName: room.name, value: t.value, createdAt: now })
          .onConflictDoNothing();
      }
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) result.push({ user, earned: fresh.map((f) => TROPHY_BY_KIND.get(f.kind)!).filter(Boolean) });
    }
  }
  return result;
}

/** Коллекция человека: что получено и сколько раз, новые сверху. */
export async function userTrophies(db: Db, userId: number) {
  const rows = await db.select().from(trophies).where(eq(trophies.userId, userId)).orderBy(desc(trophies.id));
  const counts = new Map<string, { def: TrophyDef; count: number; lastWeek: string; room: string }>();
  for (const row of rows) {
    const def = TROPHY_BY_KIND.get(row.kind);
    if (!def) continue;
    const entry = counts.get(row.kind);
    if (entry) entry.count++;
    else counts.set(row.kind, { def, count: 1, lastWeek: row.week, room: row.roomName });
  }
  return {
    earned: [...counts.values()],
    total: counts.size,
    of: TROPHIES.length,
  };
}
