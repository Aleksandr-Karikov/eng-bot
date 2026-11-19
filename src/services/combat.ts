import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { combatSpends, users, type User } from "../db/schema";
import { damageBalanceDeci, mobClaims, withCombatLock } from "./combat-ledger";
import { latestDigestMoment } from "./digest";
import { goalProgress } from "./goals";
import { getRoom, isMember } from "./rooms";

export const MOBS = [
  { id: "golem", name: "Каменный дозорный", hp: 12, reward: "+4 монеты", coins: 4 },
  { id: "ghost", name: "Чернильный призрак", hp: 20, reward: "+20% базового урона диктантов до конца недели", coins: 0 },
] as const;

export type CombatTarget = "boss" | (typeof MOBS)[number]["id"];

export async function combatState(db: Db, user: User, now: Date) {
  const claims = await mobClaims(db, user.id, latestDigestMoment(now).date);
  return {
    bank: user.bankDamage,
    balance: (await damageBalanceDeci(db, user.id)) / 10,
    mobs: MOBS.map(({ coins, ...mob }) => ({ ...mob, defeated: claims.some((claim) => claim.target === mob.id) })),
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
      if (balance < damageDeci) return;
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
