import { and, eq } from "drizzle-orm";
import { HUNTER_RELICS, MOBS, type CombatTarget } from "../combat-mobs";
import { maxBossAttackStake, MIN_BOSS_ATTACK_STAKE } from "../boss-attack-rules";
import type { Db } from "../db/client";
import { combatSpends, users, type User } from "../db/schema";
import { availableRune, damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment, roomTimeZone } from "./digest";
import { bossOf, RUNE_PRICE, type BossState } from "./boss";
import { getRoom, isMember } from "./rooms";
import { streakBuff } from "./streak-buff";

export function isMobTarget(target: unknown): target is Exclude<CombatTarget, "boss"> {
  return MOBS.some((mob) => mob.id === target);
}

export async function combatState(db: Db, user: User, now: Date, boss: BossState) {
  const [claims, weeks, balance, rune, streak] = await Promise.all([
    // Неделя боя уже посчитана по поясу комнаты — берём её, а не считаем заново по общему поясу.
    mobClaims(db, user.id, boss.week), mobHuntWeeks(db, user.id), damageBalanceDeci(db, user.id),
    availableRune(db, user), streakBuff(db, user, now),
  ]);
  return {
    balance: balance / 10,
    attackCost: MIN_BOSS_ATTACK_STAKE,
    maxAttackStake: maxBossAttackStake(boss.hp, balance / 10),
    mobs: MOBS.map(({ coins, skill, ...mob }) => ({
      ...mob,
      reward: skill
        ? `${skill === "listen" ? "Диктанты" : "Пропуски и свои предложения"}: +20% к базовой энергии до конца недели`
        : `Монеты: +${coins}`,
      defeated: claims.some((claim) => claim.target === mob.id),
    })),
    hunt: { weeks, thisWeek: claims.length > 0, relics: HUNTER_RELICS },
    streak,
    rune: { price: RUNE_PRICE, owned: rune !== null },
  };
}

type Attack = { week: string; roomId: number; requestId: string } & (
  { target: Exclude<CombatTarget, "boss">; maxDamageDeci: number }
  | { target: "boss"; round: number; stake: number; damage: number }
);

export function attackWithReserve(db: Db, userId: number, input: Attack, now: () => Date) {
  return withCombatLock(db, async () => {
    const at = now();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.modeBoss || user.currentRoomId !== input.roomId) return;
    const room = await getRoom(db, input.roomId);
    if (!room || !(await isMember(db, room.id, userId))) return;
    // Неделя — по поясу комнаты: у комнаты в Москве бой кончается в 20:00 МСК, а не по общему поясу.
    const week = latestDigestMoment(at, roomTimeZone(room)).date;
    if (week !== input.week) return;

    if (input.target === "boss") {
      const [prior] = await db.select({ damage: combatSpends.bossDamageDeci }).from(combatSpends)
        .where(and(eq(combatSpends.userId, userId), eq(combatSpends.roomId, room.id),
          eq(combatSpends.requestId, input.requestId), eq(combatSpends.target, "boss")));
      if (prior?.damage != null) return prior.damage / 10;
    }

    const balance = await damageBalanceDeci(db, userId);
    if (!balance) return;
    let values: Pick<typeof combatSpends.$inferInsert, "damageDeci" | "bossDamageDeci" | "runeSerial">;
    if (input.target !== "boss") {
      const mob = MOBS.find((entry) => entry.id === input.target);
      if (!mob) return;
      const damageDeci = mob.hp * 10;
      if (balance < damageDeci || input.maxDamageDeci !== damageDeci) return;
      values = { damageDeci };
    } else {
      const cost = input.stake * 10;
      if (balance < cost) return;
      const boss = await bossOf(db, room, at);
      if (boss.hp <= 0 || input.round !== boss.round) return;
      const hp = Math.round(boss.hp * 10);
      const damage = Math.round(input.damage * 10);
      const rune = damage > 0 && damage < hp ? await availableRune(db, user) : null;
      const bonus = rune === null ? 0 : Math.min(100, Math.floor(damage / 4));
      values = { damageDeci: cost, bossDamageDeci: Math.min(hp, damage + bonus), runeSerial: bonus ? rune : null };
    }
    const [strike] = await db.insert(combatSpends)
      .values({
        userId, roomId: input.target === "boss" ? room.id : null, target: input.target,
        mobWeek: input.target === "boss" ? null : week, requestId: input.requestId, at, ...values,
      })
      .onConflictDoNothing().returning({ damageDeci: combatSpends.damageDeci, bossDamageDeci: combatSpends.bossDamageDeci });
    return strike ? (strike.bossDamageDeci ?? strike.damageDeci) / 10 : undefined;
  });
}
