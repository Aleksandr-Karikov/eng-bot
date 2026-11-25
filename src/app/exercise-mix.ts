import type { Stage } from "../services/exercises";

export const CHOICE_INDEX = 5;

type ExerciseSlot = { index: number; stage: Stage };

// Две карточки между соседними упражнениями и по две на краях полной серии.
const EXERCISE_SLOTS: ExerciseSlot[] = [
  { index: 2, stage: "listen" },
  { index: CHOICE_INDEX, stage: "collocation" },
  { index: 8, stage: "listen" },
  { index: 11, stage: "sentence" },
  { index: 14, stage: "listen" },
  { index: 17, stage: "cloze" },
];

export function scheduleExercises(available: Stage[][], size: number, withDrill: boolean) {
  const slots = EXERCISE_SLOTS
    .filter(({ index }) => index < size && !(withDrill && index === CHOICE_INDEX))
    .map((slot) => {
      const candidates = available
        .flatMap((stages, index) => stages.includes(slot.stage) ? [index] : [])
        .sort((a, b) => Math.abs(a - slot.index) - Math.abs(b - slot.index));
      return { ...slot, candidates };
    });

  const assigned = new Map<number, (typeof slots)[number]>();
  // Если подходящее слово занято, подбираем замену для его упражнения, чтобы показать оба.
  function assign(slot: (typeof slots)[number], visited: Set<number>): boolean {
    for (const cardIndex of slot.candidates) {
      if (visited.has(cardIndex)) continue;
      visited.add(cardIndex);
      const previous = assigned.get(cardIndex);
      if (previous && !assign(previous, visited)) continue;
      assigned.set(cardIndex, slot);
      return true;
    }
    return false;
  }

  for (const slot of slots) assign(slot, new Set());
  return new Map(Array.from(assigned, ([cardIndex, { index, stage }]) => [index, { cardIndex, stage }]));
}
