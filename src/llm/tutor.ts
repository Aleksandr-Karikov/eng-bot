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

/** Вопрос «работы над ошибками»: предложение с пропуском и варианты, правильный — options[correct]. */
export interface DrillQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  category: string;
}

/** Упражнения тренажёра: предложения с пропуском, проверка ответа, вопросы по слабым местам. */
export interface ExerciseTutor {
  cloze(term: string, translation: string): Promise<ClozeDraft[]>;
  judge(input: JudgeInput): Promise<Judgement>;
  drill(profile: string, count: number): Promise<DrillQuestion[]>;
}

export const CLOZE_COUNT = 3;

export function buildClozePrompt(term: string, translation: string): string {
  return [
    `Английское слово или фраза: "${term}" (значение: "${translation}").`,
    `Составь ${CLOZE_COUNT} разных коротких естественных предложения на английском, где оно пропущено (в нужной форме).`,
    "Пропуск обозначь ___ (один на предложение). Контекст должен однозначно подсказывать именно это слово, а не синоним.",
    "Предложение с подставленным ответом должно звучать естественно для носителя. В пропуске — цельный кусок текста:",
    "если фраза обычно разрывается (take something for granted), выбери вариант, где она стоит подряд (take it for granted).",
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
    'Верни JSON: {"correct": true/false, "explanation": "...", "tip": "..."}, где explanation — 1–2 коротких предложения по-русски:',
    "почему ответ подходит или нет и как правильнее; tip — одно короткое предложение, как запомнить нужное слово (можно пустую строку).",
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

export function buildDrillPrompt(profile: string, count: number): string {
  return [
    "Русскоязычный человек учит английский. Вот его типичные ошибки (тема ×сколько раз: как было → как правильно):",
    profile,
    "",
    `Составь ${count} вопроса с вариантами ответа на эти темы, чаще — на самые частые. Каждый вопрос — естественное английское`,
    "предложение с одним пропуском ___ и 3–4 короткими вариантами. Ровно один вариант верный, неверные — как раз его типичные ошибки.",
    "Не повторяй его примеры дословно — нужны новые предложения на то же правило.",
    'Верни JSON-массив: [{"question": "...", "options": ["...", "..."], "correct": 0, "explanation": "...", "category": "..."}], где',
    "correct — индекс верного варианта (с нуля), explanation — 1–2 предложения по-русски: правило и почему остальные не подходят,",
    "category — тема из списка выше.",
  ].join("\n");
}

const drillQuestion = z
  .object({
    question: z.string().trim().includes("___"),
    options: z.array(z.string().trim().min(1)).min(2).max(4),
    correct: z.number().int().min(0),
    explanation: z.string().trim().default(""),
    category: z.string().trim().default(""),
  })
  .refine((q) => q.correct < q.options.length);

export function parseDrill(text: string): DrillQuestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(`No JSON array in LLM response: ${text.slice(0, 200)}`);
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("LLM response is not an array");
  return raw.flatMap((entry) => {
    const r = drillQuestion.safeParse(entry);
    return r.success ? [r.data] : [];
  });
}
