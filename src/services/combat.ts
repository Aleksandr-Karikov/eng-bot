import { eq } from "drizzle-orm";
import { HUNTER_RELICS, MOBS, type CombatTarget } from "../combat-mobs";
import type { Db } from "../db/client";
import { combatSpends, users, type User } from "../db/schema";
import { availableRune, coreUsed, damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment } from "./digest";
import { bossOf, RUNE_PRICE, type BossState } from "./boss";
import { getRoom, isMember } from "./rooms";
import { streakBuff } from "./streak-buff";

export function isCombatTarget(target: unknown): target is CombatTarget {
  return target === "boss" || MOBS.some((mob) => mob.id === target);
}

async function coreState(db: Db, userId: number, roomId: number, boss: BossState) {
  if (boss.opponent.id !== "sentinel") return null;
  if (boss.hp > boss.target / 2) return "closed";
  return await coreUsed(db, userId, roomId, boss.week) ? "spent" : "ready";
}

/** Найти минимальный расход запаса, чтобы не переплачивать за добивающий удар. */
function reserveHit(hpDeci: number, available: number, core: boolean, rune: boolean) {
  const bonus = (spent: number) => ({
    core: core ? Math.floor(spent / 5) : 0,
    rune: rune ? Math.min(100, Math.floor(spent / 4)) : 0,
  });
  const withBonus = (spent: number) => spent + bonus(spent).core + bonus(spent).rune;
  let high = Math.max(0, Math.min(hpDeci, available));
  const damage = Math.min(hpDeci, withBonus(high));
  let low = 0;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (withBonus(middle) < damage) low = middle + 1;
    else high = middle;
  }
  const coreDamage = Math.min(damage - low, bonus(low).core);
  return { spend: low, damage, coreBonus: coreDamage, runeBonus: damage - low - coreDamage };
}

export async function combatState(db: Db, user: User, now: Date, roomId: number, boss: BossState) {
  const [claims, weeks, balance, core, rune, streak] = await Promise.all([
    mobClaims(db, user.id, latestDigestMoment(now).date), mobHuntWeeks(db, user.id), damageBalanceDeci(db, user.id),
    coreState(db, user.id, roomId, boss), availableRune(db, user), streakBuff(db, user, now),
  ]);
  const hp = Math.round(boss.hp * 10);
  const unarmed = reserveHit(hp, balance, core === "ready", false);
  const armed = reserveHit(hp, balance, core === "ready", true);
  const hit = rune === null ? unarmed : armed;
  return {
    bank: user.bankDamage,
    balance: balance / 10,
    mobs: MOBS.map(({ coins, skill, ...mob }) => ({
      ...mob,
      reward: skill
        ? `${skill === "listen" ? "Диктанты" : "Пропуски и свои предложения"}: +20% базового урона до конца недели`
        : `Монеты: +${coins}`,
      defeated: claims.some((claim) => claim.target === mob.id),
    })),
    hunt: { weeks, thisWeek: claims.length > 0, relics: HUNTER_RELICS },
    streak,
    core,
    hit: { spend: hit.spend / 10, damage: hit.damage / 10 },
    rune: { price: RUNE_PRICE, owned: rune !== null, extra: (armed.damage - unarmed.damage) / 10, saved: (unarmed.spend - armed.spend) / 10 },
  };
}

export function attackWithReserve(db: Db, userId: number, input: {
  target: CombatTarget; week: string; roomId: number; requestId: string; maxDamageDeci: number;
}, now: () => Date) {
  return withCombatLock(db, async () => {
    const at = now();
    const week = latestDigestMoment(at).date;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.modeBoss || user.currentRoomId !== input.roomId || week !== input.week) return;
    const room = await getRoom(db, input.roomId);
    if (!room || !(await isMember(db, room.id, userId))) return;

    const balance = await damageBalanceDeci(db, userId);
    if (!balance) return;
    const mob = MOBS.find((entry) => entry.id === input.target);
    let values: Pick<typeof combatSpends.$inferInsert, "damageDeci" | "bossDamageDeci" | "coreWeek" | "runeSerial">;
    if (mob) {
      const damageDeci = mob.hp * 10;
      if (balance < damageDeci || input.maxDamageDeci !== damageDeci) return;
      values = { damageDeci };
    } else {
      const boss = await bossOf(db, room, at);
      if (boss.hp <= 0) return;
      const [core, rune] = await Promise.all([coreState(db, userId, room.id, boss), availableRune(db, user)]);
      const hit = reserveHit(Math.round(boss.hp * 10), Math.min(balance, input.maxDamageDeci), core === "ready", rune !== null);
      if (hit.spend <= 0) return;
      values = {
        damageDeci: hit.spend,
        bossDamageDeci: hit.damage,
        coreWeek: hit.coreBonus > 0 ? week : null,
        runeSerial: hit.runeBonus > 0 ? rune : null,
      };
    }
    const [strike] = await db.insert(combatSpends)
      .values({ userId, roomId: mob ? null : room.id, target: input.target, mobWeek: mob ? week : null, requestId: input.requestId, at, ...values })
      .onConflictDoNothing().returning({ damageDeci: combatSpends.damageDeci, bossDamageDeci: combatSpends.bossDamageDeci });
    return strike ? (strike.bossDamageDeci ?? strike.damageDeci) / 10 : undefined;
  });
}
