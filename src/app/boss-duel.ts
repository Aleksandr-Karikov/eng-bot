import { bossAttackDamage } from "../boss-attack-rules";
import type { BossId } from "../boss-opponents";
import { shuffle } from "../services/duels";

type Phrase = readonly [prompt: string, answer: string];
type Position = "left" | "center" | "right";
export type DuelFrame = {
  threat?: Position;
  hero?: Position | "fallen";
  boss?: "airborne" | "low" | "fallen" | "shielded";
  effect?: "fire" | "bolt" | "beam" | "ice" | "pulse";
};

type Action = {
  id: string;
  label: string;
  phrases: readonly Phrase[];
  next: string | number;
  miss?: string;
  forecast?: number;
};

type Scene = { title?: string; cue: string; frame: DuelFrame; actions: Action[] };

const SCENES: Record<string, Scene> = {
  fire: {
    title: "Пламя в библиотеке",
    cue: "В конце хода Дракон ударит огнём по арбалету.",
    frame: { threat: "right", boss: "airborne" },
    actions: [
      { id: "cover", label: "Укрыться за колонной", phrases: [["Укройся", "Take cover"]], next: "landed", miss: "staggered", forecast: 2 },
      { id: "ballista", label: "Выстрелить в крыло", phrases: [["Выстрели в крыло", "Shoot at the wing"]], next: "downed", miss: "staggered", forecast: 3 },
    ],
  },
  landed: {
    cue: "Пламя прошло мимо. Дракон приземлился.",
    frame: { hero: "left", boss: "low", effect: "fire" },
    actions: [{ id: "strike", label: "Ударить с земли", phrases: [["Ударь дракона", "Strike the dragon"], ["Атакуй дракона", "Attack the dragon"]], next: 2 }],
  },
  downed: {
    cue: "Дракон рухнул. Крыло открыто для удара.",
    frame: { hero: "right", boss: "fallen", effect: "bolt" },
    actions: [{ id: "wing", label: "Ударить по крылу", phrases: [["Ударь по его крылу", "Strike its wing"], ["Целься в его крыло", "Aim for its wing"]], next: 3 }],
  },
  charge: {
    title: "Рывок над ареной",
    cue: "Дракон пикирует по центру. Колонна может остановить его.",
    frame: { threat: "center", boss: "airborne" },
    actions: [
      { id: "dodge", label: "Отскочить вправо", phrases: [["Шагни вправо", "Step to the right"]], next: "flank", miss: "staggered", forecast: 2 },
      { id: "lure", label: "Приманить к колонне", phrases: [["Примани его к колонне", "Lure it to the pillar"]], next: "pillar", miss: "staggered", forecast: 3 },
    ],
  },
  flank: {
    cue: "Дракон пролетел мимо. Его хвост совсем близко.",
    frame: { hero: "right", boss: "low" },
    actions: [{ id: "tail", label: "Ударить по хвосту", phrases: [["Ударь по его хвосту", "Strike its tail"], ["Целься в хвост", "Aim for the tail"]], next: 2 }],
  },
  pillar: {
    cue: "Дракон задел колонну. Можно ударить сейчас или удержать проход и повалить его.",
    frame: { hero: "left", boss: "low", effect: "pulse" },
    actions: [
      { id: "quick", label: "Ударить сейчас", phrases: [["Ударь, пока он близко", "Strike while it is close"]], next: 2 },
      { id: "block", label: "Удержать проход", phrases: [["Перекрой выход", "Block the exit"]], next: "grounded", miss: "counter", forecast: 3 },
    ],
  },
  grounded: {
    cue: "Дракон остался на полу. Можно ударить, пока он не взлетел.",
    frame: { hero: "left", boss: "fallen" },
    actions: [{ id: "finish", label: "Ударить снизу", phrases: [["Целься в его брюхо", "Aim for its belly"]], next: 3 }],
  },
  beam: {
    title: "Луч сквозь зал",
    cue: "Страж направил луч на правую плиту. Зеркало может его отразить.",
    frame: { threat: "right", boss: "shielded" },
    actions: [
      { id: "step", label: "Перейти на левую плиту", phrases: [["Шагни на левую плиту", "Step onto the left tile"]], next: "sentinel-rest", miss: "staggered", forecast: 2 },
      { id: "mirror", label: "Развернуть зеркало", phrases: [["Поверни зеркало к Стражу", "Turn the mirror toward the guardian"]], next: "reflected", miss: "staggered", forecast: 3 },
    ],
  },
  "sentinel-rest": {
    cue: "Луч прошёл мимо. Щит погас, пока Страж перезаряжается.",
    frame: { hero: "left", boss: "low", effect: "beam" },
    actions: [{ id: "core", label: "Ударить по ядру", phrases: [["Ударь по ядру", "Strike the core"], ["Целься в ядро", "Aim for the core"]], next: 2 }],
  },
  reflected: {
    cue: "Зеркало вернуло луч в Стража. Его ядро открыто.",
    frame: { hero: "right", boss: "fallen", effect: "beam" },
    actions: [{ id: "core", label: "Разбить ядро", phrases: [["Разбей ядро", "Break the core"], ["Разбей его ядро", "Smash its core"]], next: 3 }],
  },
  seals: {
    title: "Круг печатей",
    cue: "Страж заряжает печать слева. У зеркала можно отключить обе печати.",
    frame: { threat: "left", boss: "shielded" },
    actions: [
      { id: "center", label: "Отойти в центр", phrases: [["Отойди в центр", "Move to the center"]], next: "seals-spent", miss: "staggered", forecast: 2 },
      { id: "open", label: "Разомкнуть две печати", phrases: [["Отключи обе печати", "Disable both seals"]], next: "seals-open", miss: "staggered", forecast: 3 },
    ],
  },
  "seals-spent": {
    cue: "Печать разрядилась. Страж на миг опустил защиту.",
    frame: { boss: "low", effect: "pulse" },
    actions: [{ id: "core", label: "Атаковать Стража", phrases: [["Ударь стража", "Strike the guardian"], ["Атакуй стража", "Attack the guardian"]], next: 2 }],
  },
  "seals-open": {
    cue: "Щит Стража мерцает. Можно ударить сейчас или замкнуть печати, пока он на плите.",
    frame: { hero: "right", threat: "center", boss: "shielded", effect: "pulse" },
    actions: [
      { id: "quick", label: "Ударить сейчас", phrases: [["Ударь по щиту", "Strike the shield"]], next: 2 },
      { id: "close", label: "Замкнуть печати", phrases: [["Замкни круг", "Close the circle"]], next: "trapped", miss: "counter", forecast: 3 },
    ],
  },
  trapped: {
    cue: "Печати удерживают Стража. Можешь подойти вплотную.",
    frame: { boss: "fallen", effect: "pulse" },
    actions: [{ id: "core", label: "Ударить в упор", phrases: [["Ударь по открытому ядру", "Strike the exposed core"]], next: 3 }],
  },
  bridge: {
    title: "Ледяной мост",
    cue: "Ведьма заморозила мост справа. Лёд под ней тоже трещит.",
    frame: { threat: "right", boss: "airborne" },
    actions: [
      { id: "shore", label: "Перебежать на камень", phrases: [["Беги на камень", "Run to the rock"]], next: "frost-shore", miss: "staggered", forecast: 2 },
      { id: "ice", label: "Проломить лёд под Ведьмой", phrases: [["Разбей лёд под ней", "Break the ice beneath her"]], next: "frost-fallen", miss: "staggered", forecast: 3 },
    ],
  },
  "frost-shore": {
    cue: "Лёд лопнул мимо тебя. После заклинания Ведьма спустилась к мосту.",
    frame: { hero: "left", boss: "low", effect: "ice" },
    actions: [{ id: "attack", label: "Ударить с камня", phrases: [["Ударь ведьму", "Strike the witch"], ["Атакуй ведьму", "Attack the witch"]], next: 2 }],
  },
  "frost-fallen": {
    cue: "Ведьма провалилась и застряла. Её ледяная корона открыта.",
    frame: { hero: "right", boss: "fallen", effect: "ice" },
    actions: [{ id: "crown", label: "Разбить корону", phrases: [["Разбей её корону", "Break her crown"], ["Ударь по короне", "Strike the crown"]], next: 3 }],
  },
  blizzard: {
    title: "Белая мгла",
    cue: "Ведьма поднимает туман в центре. Кристалл справа светится изнутри.",
    frame: { threat: "center", boss: "shielded" },
    actions: [
      { id: "edge", label: "Обойти туман по краю", phrases: [["Иди вдоль стены", "Walk along the wall"]], next: "frost-flank", miss: "staggered", forecast: 2 },
      { id: "crystal", label: "Зажечь кристалл", phrases: [["Зажги ледяной кристалл", "Light the ice crystal"]], next: "frost-lit", miss: "staggered", forecast: 3 },
    ],
  },
  "frost-flank": {
    cue: "У стены туман редеет. Видно, где стоит Ведьма.",
    frame: { hero: "left", boss: "low", effect: "ice" },
    actions: [{ id: "attack", label: "Атаковать сбоку", phrases: [["Атакуй её сбоку", "Attack her from the side"]], next: 2 }],
  },
  "frost-lit": {
    cue: "Свет рассеял туман. Можно атаковать с края или ослепить Ведьму кристаллом.",
    frame: { hero: "right", boss: "shielded", effect: "pulse" },
    actions: [
      { id: "quick", label: "Атаковать издалека", phrases: [["Атакуй издалека", "Attack from a distance"]], next: 2 },
      { id: "turn", label: "Направить свет на Ведьму", phrases: [["Направь свет на неё", "Point the light at her"]], next: "frost-blind", miss: "counter", forecast: 3 },
    ],
  },
  "frost-blind": {
    cue: "Ведьма закрылась от света. Ледяная защита исчезла.",
    frame: { hero: "right", boss: "fallen", effect: "beam" },
    actions: [{ id: "attack", label: "Атаковать Ведьму", phrases: [["Ударь, пока она ослеплена", "Strike while she is blinded"]], next: 3 }],
  },
  staggered: {
    cue: "Удар сбил героя с ног. Поднимись, чтобы успеть ответить.",
    frame: { hero: "fallen", effect: "pulse" },
    actions: [{ id: "rise", label: "Встать на ноги", phrases: [["Встань на ноги", "Get back up"]], next: "recovered" }],
  },
  recovered: {
    cue: "Герой поднялся. Успей ударить, пока противник рядом.",
    frame: { boss: "low" },
    actions: [{ id: "counter", label: "Ответить ударом", phrases: [["Контратакуй сразу", "Counterattack at once"], ["Целься пониже", "Aim a little lower"]], next: 1 }],
  },
  counter: {
    cue: "План сорвался. Остаётся один шанс ответить.",
    frame: { boss: "low" },
    actions: [{ id: "counter", label: "Ответить ударом", phrases: [["Быстро контратакуй", "Counterattack quickly"]], next: 1 }],
  },
};

const OPENINGS: Record<BossId, readonly [string, string]> = {
  dragon: ["fire", "charge"],
  sentinel: ["beam", "seals"],
  frost: ["bridge", "blizzard"],
};

export type DuelScene = { opponent: BossId; opening: string; title: string; frame: DuelFrame };

export type BossDuelTurn = {
  // Название в протоколе E66 сохранено для уже открытых Mini App.
  kind: "dragon";
  scene: string;
  duel: DuelScene;
  turn: number;
  cue: string;
  choices: Array<{ id: string; label: string; prompt: string; words: string[]; damage?: number }>;
  translation?: string;
};

export function startDuel(opponent: BossId, stake: number, random: () => number, previous?: DuelScene, alternate = false): BossDuelTurn {
  const [first, second] = OPENINGS[opponent];
  const another = previous?.opponent === opponent ? previous.opening === first : random() >= 0.5;
  const opening = alternate && another ? second : first;
  return duelTurn(opponent, opening, opening, 1, stake, random);
}

function duelTurn(opponent: BossId, opening: string, scene: string, turn: number, stake: number, random: () => number, translation?: string): BossDuelTurn {
  const { cue, frame, actions } = SCENES[scene];
  return {
    kind: "dragon", scene, duel: { opponent, opening, title: SCENES[opening].title!, frame }, turn, cue, translation,
    choices: actions.map(({ id, label, phrases, next, forecast }) => {
      const [prompt, answer] = phrases[Math.floor(random() * phrases.length)];
      const original = answer.split(" ");
      const words = shuffle(original, random);
      if (words.every((word, index) => word === original[index])) words.push(words.shift()!);
      const score = typeof next === "number" ? next : forecast;
      return { id, label, prompt, words, damage: score === undefined ? undefined : bossAttackDamage(stake, score) };
    }),
  };
}

export function playDuelTurn(phase: BossDuelTurn, action: unknown, order: unknown, stake: number, random: () => number) {
  const choice = phase.choices.find(({ id }) => id === action);
  if (!choice || !Array.isArray(order) || order.length !== choice.words.length
    || new Set(order).size !== order.length
    || !order.every((index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < choice.words.length)) return;
  const rule = SCENES[phase.scene].actions.find(({ id }) => id === choice.id)!;
  const answer = rule.phrases.find(([prompt]) => prompt === choice.prompt)![1];
  const correct = order.map((index: number) => choice.words[index]).join(" ") === answer;
  const next = correct ? rule.next : rule.miss ?? 0;
  const translation = correct ? undefined : answer;
  return typeof next === "number"
    ? { kind: "finish" as const, damage: bossAttackDamage(stake, next), translation, scene: phase.scene, duel: phase.duel }
    : duelTurn(phase.duel.opponent, phase.duel.opening, next, phase.turn + 1, stake, random, translation);
}
