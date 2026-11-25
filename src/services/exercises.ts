import { State } from "ts-fsrs";
import { ANSWERS_SEP, answersOf } from "./cloze";

/** Виды упражнений: EN → RU, RU → EN, вставь по смыслу, своё предложение, диктант, сочетания. */
export const STAGES = ["en_ru", "ru_en", "cloze", "sentence", "listen", "collocation"] as const;
export type Stage = (typeof STAGES)[number];
export type StageModes = Record<Stage, boolean>;

/** С этих упражнений можно начинать знакомство с новым словом — остальные требуют его уже знать. */
const FIRST_MEETING: Stage[] = ["en_ru", "ru_en", "listen"];
/** «Своё предложение» — когда слово хоть немного знакомо: после пары повторений. */
const SENTENCE_MIN_REPS = 2;

export function reviewStages(
  card: { reps?: number }, modes: StageModes, clozeReady: boolean, collocationReady: boolean,
): Stage[] {
  return STAGES.filter(
    (s) =>
      modes[s] &&
      (s !== "cloze" || clozeReady) &&
      (s !== "collocation" || collocationReady) &&
      (s !== "sentence" || (card.reps ?? 0) >= SENTENCE_MIN_REPS),
  );
}

/**
 * Вариант упражнения для карточки — без лесенки по сложности, для разнообразия:
 * новое слово сначала EN → RU (вспомнить незнакомое нельзя), дальше — случайно из включённых.
 * «Вставь по смыслу» доступно, только когда для слова готовы предложения; если не осталось ничего — EN → RU.
 */
export function pickStage(
  card: { state: number; reps?: number },
  modes: StageModes,
  clozeReady: boolean,
  random: () => number,
  /** Для слова готов вопрос на сочетания. */
  collocationReady = false,
  weakDirection?: "en_ru" | "ru_en",
): Stage {
  if (card.state === State.New) return FIRST_MEETING.find((s) => modes[s]) ?? "en_ru";
  const available = reviewStages(card, modes, clozeReady, collocationReady);
  if (available.length === 0) return "en_ru";
  if (weakDirection && available.includes(weakDirection) && random() < 0.5) return weakDirection;
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))];
}

/** Расстояние Левенштейна — для диктанта: одна-две опечатки в длинном слове не считаются ошибкой. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Диктант: exact — точно, close — с опечаткой (1 на 5+ букв, 2 на 12+), wrong — не то. */
export function gradeDictation(answer: string, term: string): "exact" | "close" | "wrong" {
  const a = normalizeAnswer(answer);
  const t = normalizeAnswer(term);
  if (a === t) return "exact";
  const allowed = t.length >= 12 ? 2 : t.length >= 5 ? 1 : 0;
  return a !== "" && editDistance(a, t) <= allowed ? "close" : "wrong";
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

/**
 * Словарная форма подходит для одного пропуска. Для нескольких нужны ответы по порядку.
 *
 * У задания с двумя пропусками в базе лежит `have|hold`, а человек пишет оба слова подряд — `have hold`
 * (баг #25). Поэтому разделитель считается мягким: оба написания сводятся к одному.
 */
export function isExactAnswer(answer: string, expected: { answer: string; term: string }): boolean {
  const a = normalizeAnswer(answer);
  if (!a) return false;
  if (!expected.answer.includes(ANSWERS_SEP)) {
    return a === normalizeAnswer(expected.answer) || a === normalizeAnswer(expected.term);
  }
  const parts = answersOf(expected.answer).map(normalizeAnswer);
  if (!answer.includes(ANSWERS_SEP)) return a === parts.join(" ");
  return answer.split(ANSWERS_SEP).map(normalizeAnswer).join(ANSWERS_SEP) === parts.join(ANSWERS_SEP);
}
