export const MOBS = [
  { id: "golem", name: "Каменный дозорный", icon: "🪨", hp: 30, coins: 4, skill: null },
  { id: "ghost", name: "Чернильный призрак", icon: "👻", hp: 45, coins: 0, skill: "listen" },
  { id: "spider", name: "Рунный паук", icon: "🕷️", hp: 70, coins: 0, skill: "writing" },
  { id: "mimic", name: "Медный мимик", icon: "🧰", hp: 100, coins: 30, skill: null },
  { id: "chimera", name: "Лунная химера", icon: "🌙", hp: 150, coins: 55, skill: null },
] as const;

export type MobId = (typeof MOBS)[number]["id"];
export type CombatTarget = "boss" | MobId;

export const HUNTER_RELICS = [
  { weeks: 2, name: "Знак охотника", icon: "🧿", skill: "all", percent: 5 },
  { weeks: 4, name: "Эхо призрака", icon: "🔔", skill: "listen", percent: 10 },
  { weeks: 8, name: "Рунное перо", icon: "🪶", skill: "writing", percent: 10 },
] as const;
