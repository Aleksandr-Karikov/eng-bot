import { z } from "zod";
import { fixesField, jsonArray, jsonObject } from "./json";
import type { ClozeDraft } from "../services/cloze";
import { MISTAKE_CATEGORIES, type CheckResult } from "./enricher";

export { jsonObject } from "./json";

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
  /** Пожелание ученика к картинке («✍️ Свой вариант»), любыми словами. */
  wish?: string;
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

export interface TalkInput {
  topic: string;
  words: Array<{ term: string; translation: string }>;
  lines: Array<{ who: "user" | "bot"; text: string }>;
}

/** Предложение для перевода RU → EN. */
export interface TranslationTask {
  ru: string;
  /** Эталонный перевод — показываем, если «не знаю». */
  en: string;
  /** Тема ошибок, на которую предложение (из списка); "" — нет. */
  topic: string;
  /** Слово из списка, которое должно прозвучать в переводе; "" — нет. */
  word: string;
}

export interface TranslationInput {
  /** Темы ошибок ученика с примерами. */
  topics: Array<{ category: string; examples: Array<{ wrong: string; right: string }> }>;
  /** Слова, которые он сейчас учит. */
  words: Array<{ term: string; translation: string }>;
  /** Недавние предложения — не повторять. */
  avoid: string[];
}

export interface TranslationReview extends CheckResult {
  /** Смысл передан и грамматика в порядке (мелкие описки не в счёт). */
  correct: boolean;
  /** Нужное слово из задания употреблено верно; null — слова в задании не было. */
  usedWord: boolean | null;
  /** 1–2 предложения по-русски — общий вердикт. */
  verdict: string;
}

/** Частые сочетания слова и вопрос на выбор сочетания (если у слова есть типичные «партнёры»). */
export interface Collocations {
  items: Array<{ phrase: string; translation: string }>;
  quiz?: { question: string; options: string[]; correct: number; explanation: string };
}

/** «Как сказать по-английски»: варианты фразы и что из них стоит выучить. */
export interface SayAnswer {
  variants: Array<{ text: string; register: string; note: string }>;
  learn: Array<{ term: string; translation: string }>;
}

/** Разбор разговора /talk. */
export interface TalkReview {
  /** 1–2 предложения по-русски: что получилось хорошо. */
  praise: string;
  /** Ошибки в репликах ученика — как в /check. */
  fixes: CheckResult["fixes"];
  /** Фразы, которые грамматически верны, но звучат не по-английски. */
  natural: Array<{ original: string; better: string }>;
  /** Слова из списка, которые ученик сам употребил верно. */
  usedWords: string[];
}

/** Разбор слова, которое никак не запоминается. */
export interface LeechHelp {
  /** Почему именно это слово путается или забывается (1–2 предложения). */
  why: string;
  /** Чем отличается от похожих слов или значений — по строке на каждое, «word — смысл». */
  contrast: string[];
  /** 2 коротких запоминающихся примера «англ. — рус.». */
  examples: string[];
  /** Другой способ запомнить — не повторяющий запоминалку. */
  tip: string;
}

export interface StoryQuestion {
  question: string;
  options: string[];
  correct: number;
  /** Коротко по-русски — показывается во всплывающем окне (до ~150 символов). */
  explanation: string;
}

export interface StoryDraft {
  title: string;
  /** Текст истории, слова из списка выделены **так**. */
  body: string;
  questions: StoryQuestion[];
}

/** Разбор своего предложения ученика со словом. */
export interface SentenceReview extends CheckResult {
  /** Слово употреблено в нужном значении и уместно (форма может быть любой). */
  usesWord: boolean;
  /** Одно-два предложения по-русски: как употреблено слово и что не так, если не так. */
  verdict: string;
}

export interface SentenceInput {
  term: string;
  translation: string;
  explanation: string;
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
  /** Русское предложение для тренажёра перевода — под ошибки и слова ученика. */
  translationTask(input: TranslationInput): Promise<TranslationTask>;
  /** Проверка перевода ученика. */
  reviewTranslation(input: { task: TranslationTask; answer: string }): Promise<TranslationReview>;
  /** Сочетания слова: с какими словами его обычно употребляют. */
  collocations(term: string, translation: string): Promise<Collocations>;
  /** Как естественно сказать это по-английски. */
  say(phrase: string): Promise<SayAnswer>;
  /** Следующая реплика собеседника в разговоре /talk. */
  talkReply(input: TalkInput): Promise<string>;
  /** Разбор реплик ученика по итогам разговора. */
  talkReview(input: TalkInput): Promise<TalkReview>;
  /** Разбор слова, которое ученик забыл много раз. */
  untangle(word: { term: string; translation: string; explanation: string; example: string; mnemonic: string }): Promise<LeechHelp>;
  /** Короткая история с этими словами и вопросы на понимание. */
  story(words: Array<{ term: string; translation: string }>): Promise<StoryDraft>;
  /** Проверяет предложение, которое ученик составил сам: употреблено ли слово и какие ошибки вокруг. */
  reviewSentence(input: SentenceInput): Promise<SentenceReview>;
  /** avoid — недавно заданные вопросы: новые не должны их повторять. */
  drill(profile: string, count: number, avoid?: string[]): Promise<DrillQuestion[]>;
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
  return jsonArray(text).flatMap((entry) => {
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

export function buildSentencePrompt(input: SentenceInput): string {
  return [
    `Русскоязычный человек учит английское слово или фразу "${input.term}" — ${input.translation}.`,
    input.explanation ? `Смысл: ${input.explanation}` : "",
    "Его попросили составить своё предложение с этим словом. Вот что он написал:",
    input.answer,
    "",
    "1) uses_word: true, если слово или фраза есть в предложении (в любой грамматической форме) и употреблены в нужном значении и уместно.",
    "false — если слова нет, оно в другом значении или так по-английски не говорят. Мелкие ошибки вокруг слова на это не влияют.",
    "verdict — 1–2 коротких предложения по-русски: как употреблено слово; если неверно — почему и как правильно.",
    "2) Остальное проверь как обычно: исправь грамматические, орфографические и лексические ошибки, не трогая то, что и так верно.",
    "Пунктуацию и регистр не считай ошибкой. Если фраза звучит не по-английски — предложи вариант естественнее, иначе пустая строка.",
    'Верни JSON: {"uses_word": true, "verdict": "...", "corrected": "...", "fixes": [{"wrong": "...", "right": "...", "why": "...", "category": "...", "slip": false}], "natural": "..."}, где',
    "corrected — исправленный текст, изменённые слова обёрнуты в **двойные звёздочки** (если ошибок нет — исходный текст),",
    "fixes — список ошибок (пусто, если их нет), why — короткое объяснение правила по-русски,",
    `category — одна тема из списка: ${MISTAKE_CATEGORIES.join(", ")},`,
    "slip — true для описки (опечатка, пропущенная буква), false для незнания.",
  ]
    .filter(Boolean)
    .join("\n");
}

const sentenceReview = z.object({
  uses_word: z.boolean(),
  verdict: z.string().trim().default(""),
  corrected: z.string().default(""),
  fixes: fixesField,
  natural: z.string().trim().default(""),
});

export function parseSentenceReview(text: string): SentenceReview {
  const { uses_word, ...rest } = sentenceReview.parse(jsonObject(text));
  return { ...rest, usesWord: uses_word };
}

export function buildUntanglePrompt(word: { term: string; translation: string; explanation: string; example: string; mnemonic: string }): string {
  return [
    `Русскоязычный человек учит английское "${word.term}" — ${word.translation} и уже много раз его забыл.`,
    word.explanation ? `Объяснение, которое он видел: ${word.explanation}` : "",
    word.example ? `Пример, который он видел: ${word.example}` : "",
    word.mnemonic ? `Запоминалка, которая не помогла: ${word.mnemonic}` : "",
    "",
    "Помоги разобраться по-новому, не повторяя то, что он уже видел:",
    "why — 1–2 предложения: почему это слово легко путается или забывается (похоже на другое слово, несколько значений, нет прямого русского аналога, фраза длинная…);",
    "contrast — 1–3 строки «слово — чем отличается», если есть похожие слова или значения, с которыми его путают (иначе пустой массив);",
    "examples — 2 коротких ярких примера из жизни в формате «English sentence — перевод», слово в них выдели **так**;",
    "tip — другой способ запомнить: связь с известным словом, корнем, жестом или ситуацией (1–2 предложения).",
    "Пиши просто и коротко, по-русски (кроме английских примеров).",
    'Верни JSON: {"why": "...", "contrast": ["..."], "examples": ["...", "..."], "tip": "..."}',
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

const leechHelpSchema = z.object({
  why: z.string().trim().default(""),
  contrast: z.array(z.string().trim().min(1)).default([]),
  examples: z.array(z.string().trim().min(1)).default([]),
  tip: z.string().trim().default(""),
});

export function parseLeechHelp(text: string): LeechHelp {
  const help = leechHelpSchema.parse(jsonObject(text));
  if (!help.why && help.examples.length === 0) throw new Error("Empty leech help");
  return help;
}

export function buildTranslationTaskPrompt(input: TranslationInput): string {
  const topics = input.topics.map((t) => `- ${t.category}: ${t.examples.map((e) => `${e.wrong} → ${e.right}`).join("; ")}`);
  return [
    "Ты составляешь задания для тренажёра перевода с русского на английский для русскоязычного человека.",
    "Придумай одно короткое живое русское предложение (6–14 слов) из повседневной жизни, переписки или сериалов — такое, как люди реально говорят.",
    topics.length ? `Его типичные ошибки (тема: как было → как правильно):\n${topics.join("\n")}` : "",
    topics.length ? "Выбери одну тему (чаще — из первых) и построй предложение так, чтобы при переводе нужно было применить именно это правило." : "",
    input.words.length ? `Слова, которые он сейчас учит: ${input.words.map((w) => `${w.term} (${w.translation})`).join(", ")}.` : "",
    input.words.length ? "Если естественно получается — построй предложение так, чтобы в переводе напрашивалось одно из этих слов (в русском — его перевод). Не натягивай." : "",
    input.avoid.length ? `Не повторяй эти предложения и не делай похожие:\n${input.avoid.map((a) => `- ${a}`).join("\n")}` : "",
    "en — естественный перевод, как сказал бы носитель; topic — выбранная тема из списка слово в слово или пустая строка; word — слово из списка, которое должно прозвучать, слово в слово, или пустая строка.",
    'Верни JSON: {"ru": "...", "en": "...", "topic": "...", "word": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

const translationTaskSchema = z.object({
  ru: z.string().trim().min(1),
  en: z.string().trim().min(1),
  topic: z.string().trim().default(""),
  word: z.string().trim().default(""),
});

export function parseTranslationTask(text: string): TranslationTask {
  return translationTaskSchema.parse(jsonObject(text));
}

export function buildTranslationReviewPrompt(input: { task: TranslationTask; answer: string }): string {
  const { task, answer } = input;
  return [
    "Русскоязычный человек тренирует перевод с русского на английский.",
    `Задание: ${task.ru}`,
    `Один из правильных вариантов: ${task.en}`,
    task.word ? `В переводе ожидалось слово или фраза "${task.word}" (можно в любой форме; синоним — не ошибка, но used_word: false).` : "",
    `Его перевод: ${answer}`,
    "",
    "correct — true, если смысл передан и грамматически всё верно (другие слова и порядок, если так говорят, — не ошибка; описки не считаются);",
    "fixes — грамматические и лексические ошибки: wrong — как было, right — как правильно, why — коротко по-русски,",
    `category — одна тема из списка: ${MISTAKE_CATEGORIES.join(", ")}, slip — true для описки;`,
    "corrected — его перевод с исправлениями, изменённое обёрнуто в **двойные звёздочки** (если ошибок нет — как есть);",
    "natural — как естественно сказал бы носитель, если звучит не по-английски, иначе пустая строка;",
    task.word ? "used_word — употреблено ли ожидаемое слово верно;" : "used_word — null;",
    "verdict — одно короткое предложение по-русски: общий итог.",
    'Верни JSON: {"correct": true, "fixes": [{"wrong": "...", "right": "...", "why": "...", "category": "...", "slip": false}], "corrected": "...", "natural": "...", "used_word": true, "verdict": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

const translationReviewSchema = z.object({
  correct: z.boolean(),
  fixes: fixesField,
  corrected: z.string().default(""),
  natural: z.string().trim().default(""),
  used_word: z.boolean().nullable().default(null),
  verdict: z.string().trim().default(""),
});

export function parseTranslationReview(text: string): TranslationReview {
  const { used_word, ...rest } = translationReviewSchema.parse(jsonObject(text));
  return { ...rest, usedWord: used_word };
}

export function buildCollocationsPrompt(term: string, translation: string): string {
  return [
    `Английское слово или фраза: "${term}" — ${translation}.`,
    "Русскоязычные ученики часто ошибаются не в словах, а в сочетаниях: do a decision вместо make, strong rain вместо heavy.",
    "items — 3–5 самых частых и полезных сочетаний с ним (глагол + оно, прилагательное + оно, оно + предлог…), каждое с переводом;",
    "для устойчивой фразы или идиомы — 2–3 типичных способа её употребить. Только то, что реально часто говорят носители.",
    "quiz — один вопрос на выбор сочетания: естественное предложение с пропуском ___ на месте «партнёра» слова (само слово видно),",
    "3 варианта, ровно один верный, неверные — типичные ошибки русскоязычных (калька с русского). explanation — коротко по-русски.",
    "В пропуске — НЕ само слово и не его форма (prudent/prudently — это не про сочетания), а соседнее слово: глагол, прилагательное или предлог.",
    "Пример для prudent: «It would be a ___ decision to wait» нельзя — ответ виден; можно «a prudent ___ to spending» → approach / way / method.",
    "У фразового глагола (draw up, tone down) в пропуске не может быть ни сам глагол, ни частица — только дополнение или другое слово рядом.",
    "Если у слова нет типичных партнёров, на которых ошибаются (междометие, целая фраза-идиома), quiz не возвращай.",
    'Верни JSON: {"items": [{"phrase": "...", "translation": "..."}], "quiz": {"question": "...", "options": ["...", "...", "..."], "correct": 0, "explanation": "..."}}',
  ].join("\n");
}

const collocationsSchema = z.object({
  items: z.array(z.object({ phrase: z.string().trim().min(1), translation: z.string().trim().min(1) })).max(6).default([]),
  quiz: z
    .object({
      question: z.string().trim().includes("___"),
      options: z.array(z.string().trim().min(1)).min(2).max(4),
      correct: z.number().int().min(0),
      explanation: z.string().trim().default(""),
    })
    .refine((q) => q.correct < q.options.length)
    .optional()
    .catch(undefined),
});

export function parseCollocations(text: string): Collocations {
  return collocationsSchema.parse(jsonObject(text));
}

export function buildSayPrompt(phrase: string): string {
  return [
    "Русскоязычный человек хочет сказать это по-английски — в переписке с друзьями или в жизни:",
    phrase,
    "",
    "Дай 2–3 варианта, как это естественно сказал бы носитель (не дословный перевод), от самого обычного к остальным.",
    "register — одно-два слова по-русски: нейтрально, разговорно, вежливо, официально, сленг…;",
    "note — до 10 слов по-русски, когда подходит этот вариант или чем отличается (можно пустую строку).",
    "learn — 1–3 устойчивых выражения из вариантов, которые стоит выучить (не целые предложения, если в них нет ничего особенного), с переводом.",
    "Если фраза уже на английском — дай варианты, как сказать её естественнее.",
    'Верни JSON: {"variants": [{"text": "...", "register": "...", "note": "..."}], "learn": [{"term": "...", "translation": "..."}]}',
  ].join("\n");
}

const sayAnswerSchema = z.object({
  variants: z
    .array(z.object({ text: z.string().trim().min(1), register: z.string().trim().default(""), note: z.string().trim().default("") }))
    .min(1)
    .max(4),
  learn: z.array(z.object({ term: z.string().trim().min(1), translation: z.string().trim().min(1) })).max(3).default([]),
});

export function parseSayAnswer(text: string): SayAnswer {
  return sayAnswerSchema.parse(jsonObject(text));
}

const transcript = (lines: TalkInput["lines"]) => lines.map((l) => `${l.who === "user" ? "Student" : "You"}: ${l.text}`).join("\n");

export function buildTalkReplyPrompt(input: TalkInput): string {
  return [
    "Ты — живой собеседник в разговорной практике английского для русскоязычного человека (уровень B1–B2).",
    `Ситуация или тема: ${input.topic}. Играй свою роль в ней естественно, как реальный человек, а не учитель.`,
    input.words.length ? `Слова, которые он учит: ${input.words.map((w) => w.term).join(", ")}.` : "",
    "Иногда сам естественно употребляй их и задавай вопросы, на которые удобно ответить с ними — но не больше одного слова из списка за реплику.",
    "Отвечай только по-английски, 1–3 коротких предложения, в конце — вопрос или реплика, на которую хочется ответить.",
    "Не исправляй его ошибки и не объясняй грамматику — разбор будет в конце. Если он пишет по-русски, мягко попроси сказать по-английски.",
    "",
    input.lines.length ? `Разговор до сих пор:\n${transcript(input.lines)}` : "Начни разговор первой репликой.",
    "",
    'Верни JSON: {"reply": "твоя следующая реплика"}',
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

export function parseTalkReply(text: string): string {
  // Без JSON — берём ответ как есть: реплика важнее формата.
  let raw = text;
  try {
    raw = z.object({ reply: z.string() }).parse(jsonObject(text)).reply;
  } catch {
    // не JSON — оставляем текст
  }
  const reply = raw.trim().replace(/^You:\s*/i, "").trim();
  if (!reply) throw new Error("Empty talk reply");
  return reply;
}

export function buildTalkReviewPrompt(input: TalkInput): string {
  return [
    "Русскоязычный человек тренировал разговорный английский. Тема: " + input.topic + ".",
    input.words.length ? `Слова, которые он учит: ${input.words.map((w) => `${w.term} (${w.translation})`).join(", ")}.` : "",
    "",
    "Разговор (Student — он, You — собеседник):",
    transcript(input.lines),
    "",
    "Разбери только реплики Student:",
    "praise — 1–2 предложения по-русски: что получилось хорошо (конкретно, без общих слов);",
    "fixes — грамматические, орфографические и лексические ошибки: wrong — как было, right — как правильно, why — коротко по-русски,",
    `category — одна тема из списка: ${MISTAKE_CATEGORIES.join(", ")}, slip — true для описки или чатового сокращения;`,
    "пунктуацию, регистр и сокращения вроде gonna, u, thx ошибкой не считай;",
    "natural — до 3 фраз, которые грамматически верны, но звучат не по-английски: original и better;",
    "used_words — слова из списка, которые Student сам употребил верно (в любой форме), в словарной форме из списка.",
    'Верни JSON: {"praise": "...", "fixes": [{"wrong": "...", "right": "...", "why": "...", "category": "...", "slip": false}], "natural": [{"original": "...", "better": "..."}], "used_words": ["..."]}',
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

const talkReviewSchema = z.object({
  praise: z.string().trim().default(""),
  fixes: fixesField,
  natural: z.array(z.object({ original: z.string().trim().min(1), better: z.string().trim().min(1) })).default([]),
  used_words: z.array(z.string().trim().min(1)).default([]),
});

export function parseTalkReview(text: string): TalkReview {
  const { used_words, ...rest } = talkReviewSchema.parse(jsonObject(text));
  return { ...rest, usedWords: used_words };
}

export const STORY_QUESTIONS = 3;

export function buildStoryPrompt(words: Array<{ term: string; translation: string }>): string {
  return [
    "Русскоязычные друзья учат английский. Вот слова и фразы, которые они недавно добавили:",
    ...words.map((w) => `- ${w.term} — ${w.translation}`),
    "",
    "Напиши короткую живую историю или диалог на английском (120–180 слов, уровень B1–B2), где естественно встречаются эти слова,",
    "каждое хотя бы раз, в своём значении. Сюжет связный и с изюминкой — смешной поворот или неожиданная концовка, без морали.",
    "Каждое употребление слова из списка выдели **двойными звёздочками** (в той форме, в какой оно стоит в тексте).",
    "Если слово грубое — употреби его, но без пошлости. Остальная лексика проще, чем слова из списка.",
    `Потом ${STORY_QUESTIONS} вопроса на понимание по-английски, с 3 короткими вариантами ответа, один верный.`,
    "Вопросы — о сюжете, но такие, где ответ зависит от смысла слов из списка.",
    'Верни JSON: {"title": "...", "body": "...", "questions": [{"question": "...", "options": ["...", "...", "..."], "correct": 0, "explanation": "..."}]}, где',
    "correct — индекс верного варианта (с нуля), explanation — до 150 символов по-русски: почему верно, с переводом нужного слова.",
    "В body абзацы разделяй пустой строкой.",
  ].join("\n");
}

const storySchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  questions: z
    .array(
      z
        .object({
          question: z.string().trim().min(1),
          options: z.array(z.string().trim().min(1)).min(2).max(4),
          correct: z.number().int().min(0),
          explanation: z.string().trim().default(""),
        })
        .refine((q) => q.correct < q.options.length),
    )
    .min(1),
});

export function parseStory(text: string): StoryDraft {
  return storySchema.parse(jsonObject(text));
}

const judgement = z.object({
  correct: z.boolean(),
  explanation: z.string().trim().default(""),
  tip: z.string().trim().default(""),
});

export function parseJudgement(text: string): Judgement {
  return judgement.parse(jsonObject(text));
}

export function buildDrillPrompt(profile: string, count: number, avoid: string[] = []): string {
  return [
    "Русскоязычный человек учит английский. Вот его типичные ошибки (тема ×сколько раз: как было → как правильно):",
    profile,
    "",
    `Составь ${count} вопроса с вариантами ответа на эти темы, чаще — на самые частые. Каждый вопрос — естественное английское`,
    "предложение с одним пропуском ___ и 3–4 короткими вариантами. Ровно один вариант верный, неверные — как раз его типичные ошибки.",
    "В варианте — только то, что вставляется в пропуск, без соседних слов из предложения: «We need ___ gold» → варианты «the», «a», «—».",
    "Если верно «ничего не ставить» (нулевой артикль), этот вариант пиши как «—».",
    "Не повторяй его примеры дословно — нужны новые предложения на то же правило.",
    'Верни JSON-массив: [{"question": "...", "options": ["...", "..."], "correct": 0, "explanation": "...", "category": "..."}], где',
    "correct — индекс верного варианта (с нуля), explanation — 1–2 предложения по-русски: правило и почему остальные не подходят,",
    "category — тема из списка выше, слово в слово.",
    ...(avoid.length
      ? ["", "Эти вопросы уже задавались — не повторяй их и не делай почти такие же (другие слова, другая ситуация):", ...avoid.map((q) => `- ${q}`)]
      : []),
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
  return jsonArray(text).flatMap((entry) => {
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
  const answer = mnemonicAnswer.parse(jsonArray(text));
  return Array.from({ length: count }, (_, k) => answer.find((a) => a.i === k + 1)?.final ?? "");
}

/**
 * Сцена для картинки-подсказки. Рисует FLUX schnell: он понимает только буквальное и видимое,
 * поэтому Claude перебирает сцены и выбирает ту, по которой значение угадывается без подписи.
 */
export function buildImagePromptPrompt(word: ImageSubject): string {
  return [
    `Английское слово или фраза: "${word.term}" — ${word.translation}.`,
    word.explanation ? `Смысл: ${word.explanation}` : "",
    word.example ? `Пример: ${word.example}` : "",
    word.wish ? `Ученик хочет такую картинку: «${word.wish}». Сделай именно её, не теряя связи со смыслом слова.` : "",
    "",
    "Придумай картинку-подсказку для карточки: увидев её без подписи, человек должен догадаться о значении.",
    "Рисует небыстрая локальная модель (FLUX schnell), она понимает только буквальные, видимые вещи.",
    "",
    "Как думать:",
    "1. Набросай про себя 3 сцены и выбери ту, по которой значение угадывается легче всего.",
    "2. Рисуй значение, а не слова: идиому — ситуацию, в которой её говорят (nail it — человек ликует у идеально законченной работы, а не молоток и гвоздь);",
    "   абстрактное слово — бытовую сцену, где оно очевидно; чувство — преувеличенным лицом и позой.",
    "3. Один главный герой или предмет в центре, максимум два персонажа. Узнаваемая обстановка одной-двумя деталями.",
    "4. Близкая сцена с действием или предметом в руках лучше далёкого здания или пейзажа: замок, собор, горы сами по себе значение не подсказывают",
    "   (heritage — бабушка передаёт внучке старую шкатулку с семейными фотографиями, а не они вдвоём у замка).",
    "",
    "Чего модель не умеет — избегай: читаемый текст, буквы, цифры, вывески, экраны с надписями (старые письма, книги, фотографии",
    "как предметы можно — лишь бы на них ничего не надо было читать);",
    "толпы и много одинаковых предметов; руки крупным планом с мелкими предметами; символы и метафоры (стрелки, знаки вопроса, лампочки над головой);",
    "разделённые кадры «до/после».",
    "",
    "Описание сцены: по-английски, 30–45 слов, обычными предложениями. Сначала главный герой и что он делает, потом выражение лица/поза,",
    "потом обстановка, в конце ракурс (close-up, medium shot). Без указаний стиля и освещения — стиль добавится отдельно. Неприличное — без откровенности.",
    'Верни JSON: {"idea": "одна фраза по-русски: что на картинке и почему это подсказывает значение", "prompt": "..."}',
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

const imagePromptSchema = z.object({ idea: z.string().optional(), prompt: z.string().trim().min(1) });

export function parseImagePrompt(text: string): string {
  return imagePromptSchema.parse(jsonObject(text)).prompt;
}
