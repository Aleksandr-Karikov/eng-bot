import { State } from "ts-fsrs";

/** Ступени лесенки по возрастанию сложности. */
export const STAGES = ["en_ru", "ru_en", "cloze"] as const;
export type Stage = (typeof STAGES)[number];
export type StageModes = Record<Stage, boolean>;

/** Стабильность (в днях), с которой начинается ступень. */
const RU_EN_FROM = 3;
const CLOZE_FROM = 14;

export function targetStage(card: { state: number; stability: number }): Stage {
  if (card.state === State.New || card.stability < RU_EN_FROM) return "en_ru";
  return card.stability < CLOZE_FROM ? "ru_en" : "cloze";
}

/**
 * Ближайшая включённая ступень не выше целевой, иначе ближайшая выше.
 * Cloze недоступна, пока для слова нет предложений; если не осталось ничего — EN → RU.
 */
export function chooseStage(target: Stage, modes: StageModes, clozeReady: boolean): Stage {
  const available = STAGES.filter((s) => modes[s] && (s !== "cloze" || clozeReady));
  if (available.length === 0) return "en_ru";
  const t = STAGES.indexOf(target);
  const below = available.filter((s) => STAGES.indexOf(s) <= t);
  return below.length ? below[below.length - 1] : available[0];
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
