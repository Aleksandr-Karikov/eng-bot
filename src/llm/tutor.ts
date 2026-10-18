import { z } from "zod";
import type { ClozeDraft } from "../services/cloze";

export interface MnemonicItem {
  term: string;
  /** "" — перевод ещё неизвестен (запоминалка пишется параллельно с переводом). */
  translation: string;
}

export interface ImageSubject {
  term: string;
  translation: string;
  explanation: string;
  example: string;
}

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
  /** Запоминалки для слов (по порядку; "" — не вышло): образ, разбор по частям, связь или сценка — что подходит. */
  mnemonics(items: MnemonicItem[]): Promise<string[]>;
  /** Короткое английское описание сцены, показывающей смысл слова, — для рисовалки картинок. */
  imagePrompt(word: ImageSubject): Promise<string>;
}

export const CLOZE_COUNT = 3;

export function buildClozePrompt(term: string, translation: string): string {
  return [
    `Английское слово или фраза: "${term}" (значение: "${translation}").`,
    `Составь ${CLOZE_COUNT} разных коротких естественных предложения на английском, где оно пропущено (в нужной форме).`,
    "Пропуск обозначь ___ (один на предложение). Контекст должен однозначно подсказывать именно это слово, а не синоним.",
    "Если это фраза из нескольких слов — пропускай только ключевую часть (одно-два слова), остальная фраза остаётся видна:",
    "«We shouldn't take it for ___» → answer «granted». Если это одно слово — пропускай его целиком.",
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

/**
 * Запоминалка в два шага: кандидаты каждого приёма с честной оценкой, затем итог из сильных
 * (один или два, если оба хороши и дополняют друг друга — например, образ + происхождение).
 */
export function buildMnemonicPrompt(items: MnemonicItem[]): string {
  return [
    "Ты помогаешь русскоязычным запомнить английские слова. Для каждого слова действуй в два шага.",
    "Шаг 1 — кандидаты. Набросай по одному варианту каждого приёма и честно оцени, насколько он поможет вспомнить значение (score 1–10):",
    "- image: яркий образ или созвучие с русским словом — только если созвучие естественное и само всплывает (beset → «бес сэт»: бесы окружили);",
    "- parts: разбор по частям или происхождение, если оно проясняет смысл (heritage ← heir, наследник);",
    "- link: связь со знакомым английским словом или корнем (fuse → fusion, confuse);",
    "- scene: короткая живая сценка употребления.",
    "Шаг 2 — итог (final). Собери запоминалку из лучших кандидатов: один, если сильный только один; два, если оба со score ≥ 7",
    "и дополняют друг друга (например, образ + происхождение). По-русски, 1–3 предложения, понятно с первого прочтения, без натяжек.",
    'Верни JSON-массив: [{"i": 1, "candidates": [{"technique": "image", "text": "...", "score": 8}, ...], "final": "...", "used": ["image", "parts"]}]',
    "",
    ...items.map((w, i) => `${i + 1}. ${w.term}${w.translation ? ` — ${w.translation}` : ""}`),
  ].join("\n");
}

const mnemonicAnswer = z.array(z.object({ i: z.number(), final: z.string().trim() }).passthrough());

/** Итоговые запоминалки по порядку пунктов; "" там, где модель ничего не вернула. */
export function parseMnemonics(text: string, count: number): string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(`No JSON array in LLM response: ${text.slice(0, 200)}`);
  const answer = mnemonicAnswer.parse(JSON.parse(text.slice(start, end + 1)));
  return Array.from({ length: count }, (_, k) => answer.find((a) => a.i === k + 1)?.final ?? "");
}

export function buildImagePromptPrompt(word: ImageSubject): string {
  return [
    `Английское слово или фраза: "${word.term}" — ${word.translation}.`,
    word.explanation ? `Смысл: ${word.explanation}` : "",
    word.example ? `Пример: ${word.example}` : "",
    "Опиши одну сцену, которая наглядно показывает этот смысл, для генератора картинок: по-английски, 15–25 слов.",
    "Главное действие или предмет крупным планом, 1–2 персонажа или предмета, без второстепенного фона.",
    "Только сюжет, без указаний стиля (стиль добавится отдельно). Никакого текста, букв и надписей на картинке.",
    'Верни JSON: {"prompt": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

const imagePromptSchema = z.object({ prompt: z.string().trim().min(1) });

export function parseImagePrompt(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`No JSON in LLM response: ${text.slice(0, 200)}`);
  return imagePromptSchema.parse(JSON.parse(text.slice(start, end + 1))).prompt;
}
