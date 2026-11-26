import { bossAttackDamage } from "../boss-attack-rules";
import { shuffle } from "../services/duels";

type Action = {
  id: string;
  label: string;
  prompt: string;
  answer: string;
  next: Step | number;
  miss?: Step;
};

type Step = "fire" | "landed" | "downed" | "staggered" | "recovered";

const SCENES: Record<Step, { cue: string; actions: Action[] }> = {
  fire: {
    cue: "В конце хода Дракон ударит огнём по арбалету.",
    actions: [
      { id: "cover", label: "Укрыться за колонной", prompt: "Укройся", answer: "Take cover", next: "landed", miss: "staggered" },
      { id: "ballista", label: "Выстрелить в крыло", prompt: "Выстрели в крыло", answer: "Shoot at the wing", next: "downed", miss: "staggered" },
    ],
  },
  landed: {
    cue: "Пламя прошло мимо. Дракон приземлился.",
    actions: [{ id: "strike", label: "Ударить с земли", prompt: "Ударь дракона", answer: "Strike the dragon", next: 2 }],
  },
  downed: {
    cue: "Дракон рухнул. Крыло открыто для удара.",
    actions: [{ id: "wing", label: "Ударить по крылу", prompt: "Ударь по его крылу", answer: "Strike its wing", next: 3 }],
  },
  staggered: {
    cue: "Пламя сбило героя с ног. Поднимись, чтобы успеть ответить.",
    actions: [{ id: "rise", label: "Встать на ноги", prompt: "Встань на ноги", answer: "Get back up", next: "recovered" }],
  },
  recovered: {
    cue: "Герой поднялся. Успей ударить, пока Дракон рядом.",
    actions: [{ id: "counter", label: "Ударить по лапам", prompt: "Ударь по его лапам", answer: "Strike its legs", next: 1 }],
  },
};

export type DragonTurn = {
  kind: "dragon";
  scene: Step;
  turn: number;
  cue: string;
  choices: Array<{ id: string; label: string; prompt: string; words: string[]; damage?: number }>;
  translation?: string;
};

export function dragonTurn(scene: Step, turn: number, stake: number, random: () => number, translation?: string): DragonTurn {
  const { cue, actions } = SCENES[scene];
  return {
    kind: "dragon", scene, turn, cue, translation,
    choices: actions.map(({ id, label, prompt, answer, next }) => {
      const original = answer.split(" ");
      const words = shuffle(original, random);
      if (words.every((word, index) => word === original[index])) words.push(words.shift()!);
      const following = typeof next === "number" ? next : SCENES[next].actions[0].next;
      const damage = typeof following === "number" ? bossAttackDamage(stake, following) : undefined;
      return { id, label, prompt, words, damage };
    }),
  };
}

export function playDragonTurn(phase: DragonTurn, action: unknown, order: unknown, stake: number, random: () => number) {
  const choice = phase.choices.find(({ id }) => id === action);
  const rule = SCENES[phase.scene].actions.find(({ id }) => id === action);
  if (!choice || !rule || !Array.isArray(order) || order.length !== choice.words.length
    || new Set(order).size !== order.length
    || !order.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < choice.words.length)) return;

  const correct = order.map((index: number) => choice.words[index]).join(" ") === rule.answer;
  const next = correct ? rule.next : rule.miss ?? 0;
  const translation = correct ? undefined : rule.answer;
  return typeof next === "number"
    ? { kind: "finish" as const, damage: bossAttackDamage(stake, next), translation }
    : dragonTurn(next, phase.turn + 1, stake, random, translation);
}
