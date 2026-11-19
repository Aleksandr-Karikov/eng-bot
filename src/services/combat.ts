import { eq } from "drizzle-orm";
import { HUNTER_RELICS, MOBS, type CombatTarget } from "../combat-mobs";
import type { Db } from "../db/client";
import { combatSpends, users, type User } from "../db/schema";
import { damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment } from "./digest";
import { goalProgress } from "./goals";
import { getRoom, isMember } from "./rooms";

export function isCombatTarget(target: unknown): target is CombatTarget {
  return target === "boss" || MOBS.some((mob) => mob.id === target);
}

export async function combatState(db: Db, user: User, now: Date) {
  const [claims, weeks, balance] = await Promise.all([
    mobClaims(db, user.id, latestDigestMoment(now).date), mobHuntWeeks(db, user.id), damageBalanceDeci(db, user.id),
  ]);
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
    let damageDeci: number;
    if (mob) {
      damageDeci = mob.hp * 10;
      if (balance < damageDeci || input.maxDamageDeci !== damageDeci) return;
    } else {
      const boss = await goalProgress(db, room, at);
      damageDeci = Math.min(balance, input.maxDamageDeci, Math.round((boss.target - boss.done) * 10));
      if (damageDeci <= 0) return;
    }
    const [strike] = await db.insert(combatSpends)
      .values({ userId, roomId: mob ? null : room.id, target: input.target, mobWeek: mob ? week : null, requestId: input.requestId, damageDeci, at })
      .onConflictDoNothing().returning({ damageDeci: combatSpends.damageDeci });
    return strike ? strike.damageDeci / 10 : undefined;
  });
}
