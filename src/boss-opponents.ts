export const BOSS_OPPONENTS = {
  dragon: { id: "dragon", name: "Дракон библиотеки", shortName: "Дракон" },
  sentinel: { id: "sentinel", name: "Страж обсерватории", shortName: "Страж" },
  frost: { id: "frost", name: "Ледяная ведьма", shortName: "Ведьма" },
} as const;

export type BossId = keyof typeof BOSS_OPPONENTS;
