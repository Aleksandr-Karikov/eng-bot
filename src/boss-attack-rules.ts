const DAMAGE_TENTHS = [0, 5, 10, 18];

export const MIN_BOSS_ATTACK_STAKE = 10;
export const BOSS_ATTACK_ROUNDS = DAMAGE_TENTHS.length - 1;

export function maxBossAttackStake(hp: number, balance: number): number {
  return hp > 0 ? Math.min(Math.floor(balance), Math.max(MIN_BOSS_ATTACK_STAKE, Math.ceil(hp * 2))) : 0;
}

export function bossAttackDamage(stake: number, correct: number, miss = false): number {
  const damageDeci = stake * DAMAGE_TENTHS[correct];
  return (miss ? Math.round(damageDeci / 2) : damageDeci) / 10;
}
