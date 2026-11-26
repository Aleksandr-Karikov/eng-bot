export const BOSS_OPPONENTS = {
  dragon: { id: "dragon", name: "Дракон библиотеки" },
  sentinel: { id: "sentinel", name: "Страж обсерватории" },
  frost: { id: "frost", name: "Ледяная ведьма" },
} as const;

export type BossId = keyof typeof BOSS_OPPONENTS;
