import { z } from "zod";
import type { ClozeDraft } from "../services/cloze";

export interface Judgement {
  /** Ответ подходит по смыслу и грамматике (синоним, допустимая форма, мелкая опечатка). */
  correct: boolean;
  explanation: string;
  tip: string;
}

export interface JudgeInput {
  sentence: string;
  expected: string;
  term: string;
  translation: string;
  answer: string;
}

/** Упражнения тренажёра: предложения с пропуском и проверка ответа. */
export interface ExerciseTutor {
  cloze(term: string, translation: string): Promise<ClozeDraft[]>;
  judge(input: JudgeInput): Promise<Judgement>;
}

export const CLOZE_COUNT = 3;

export function buildClozePrompt(term: string, translation: string): string {
  return [
    `Английское слово или фраза: "${term}" (значение: "${translation}").`,
    `Составь ${CLOZE_COUNT} разных коротких естественных предложения на английском, где оно пропущено (в нужной форме).`,
    "Пропуск обозначь ___ . Контекст должен однозначно подсказывать именно это слово, а не синоним.",
    'Верни JSON-массив: [{"sentence": "...", "answer": "...", "translation": "..."}], где',
    "answer — точная форма, которая стоит в пропуске, translation — перевод всего предложения на русский.",
  ].join("\n");
}

const clozeItem = z.object({
  sentence: z.string().trim().includes("___"),
  answer: z.string().trim().min(1),
  translation: z.string().trim().default(""),
});

export function parseCloze(text: string): ClozeDraft[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(`No JSON array in LLM response: ${text.slice(0, 200)}`);
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("LLM response is not an array");
  return raw.flatMap((entry) => {
    const r = clozeItem.safeParse(entry);
    return r.success ? [r.data] : [];
  });
}

export function buildJudgePrompt(input: JudgeInput): string {
  return [
    "Русскоязычный человек учит английский и вставил слово в пропуск.",
    `Предложение: ${input.sentence}`,
    `Ожидалось: "${input.expected}" (словарная форма "${input.term}", значение "${input.translation}").`,
    `Ответ ученика: "${input.answer}"`,
    "Засчитай (correct: true), если ответ подходит в это предложение по смыслу и грамматике: синоним, другая допустимая форма, мелкая опечатка.",
    "Иначе correct: false.",
    'Верни JSON: {"correct": true/false, "explanation": "...", "tip": "..."}, где explanation — коротко по-русски,',
    "почему ответ подходит или нет и как правильнее; tip — совет, как запомнить нужное слово (можно пустую строку).",
  ].join("\n");
}

const judgement = z.object({
  correct: z.boolean(),
  explanation: z.string().trim().default(""),
  tip: z.string().trim().default(""),
});

export function parseJudgement(text: string): Judgement {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`No JSON in LLM response: ${text.slice(0, 200)}`);
  return judgement.parse(JSON.parse(text.slice(start, end + 1)));
}
