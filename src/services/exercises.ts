import { State } from "ts-fsrs";

/** Ступени лесенки по возрастанию сложности. */
export const STAGES = ["en_ru", "ru_en", "cloze"] as const;
export type Stage = (typeof STAGES)[number];
export type StageModes = Record<Stage, boolean>;

/**
 * Вариант упражнения для карточки — без лесенки по сложности, для разнообразия:
 * новое слово сначала EN → RU (вспомнить незнакомое нельзя), дальше — случайно из включённых.
 * «Вставь по смыслу» доступно, только когда для слова готовы предложения; если не осталось ничего — EN → RU.
 */
export function pickStage(card: { state: number }, modes: StageModes, clozeReady: boolean, random: () => number): Stage {
  const available = STAGES.filter((s) => modes[s] && (s !== "cloze" || clozeReady));
  if (available.length === 0) return "en_ru";
  if (card.state === State.New) return available[0];
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))];
}

export function normalizeAnswer(s: string): string {
  return s
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,!?;:…]+$/u, "")
    .trim();
}

/** Ответ совпал с формой в пропуске или со словарной формой слова. */
export function isExactAnswer(answer: string, expected: { answer: string; term: string }): boolean {
  const a = normalizeAnswer(answer);
  return a !== "" && (a === normalizeAnswer(expected.answer) || a === normalizeAnswer(expected.term));
}
