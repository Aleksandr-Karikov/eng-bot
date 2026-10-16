import { z } from "zod";

export interface Enrichment {
  translation: string;
  explanation: string;
  example: string;
  /** IPA в британском и американском произношении, например "/bæŋk/"; "" если Claude не дал. */
  transcriptionUk?: string;
  transcriptionUs?: string;
}

export interface ExtractedItem extends Enrichment {
  term: string;
}

export interface CheckResult {
  /** Исправленный текст; изменённые места обёрнуты в **…**. Если ошибок нет — исходный текст. */
  corrected: string;
  fixes: Array<{ wrong: string; right: string; why: string }>;
  /** Вариант, который звучит естественнее, или "" если и так нормально. */
  natural: string;
}

export interface WordEnricher {
  enrich(term: string, translationHint?: string): Promise<Enrichment>;
  /** Выделяет из текста или списка слова и фразы, полезные для изучения, сразу с переводом. */
  extract(text: string): Promise<ExtractedItem[]>;
  /** Проверяет английский текст: ошибки обязательно, «как естественнее» — отдельно. */
  check(text: string): Promise<CheckResult>;
}

/** В клавиатуре пачки слова листаются страницами, так что 100 пунктов укладываются в лимит кнопок Telegram. */
export const MAX_EXTRACT = 100;

const enrichmentFields = {
  translation: z.string().trim().min(1),
  explanation: z.string().trim().default(""),
  example: z.string().trim().default(""),
  transcription_uk: z.string().trim().default(""),
  transcription_us: z.string().trim().default(""),
};

const toEnrichment = <T extends { transcription_uk: string; transcription_us: string }>({
  transcription_uk,
  transcription_us,
  ...rest
}: T) => ({ ...rest, transcriptionUk: transcription_uk, transcriptionUs: transcription_us });

const enrichmentSchema = z.object(enrichmentFields).transform(toEnrichment);

const TRANSCRIPTION_HINT =
  "transcription_uk и transcription_us — транскрипция IPA в британском (RP) и американском произношении в слешах, для фразы — целиком.";

export const SYSTEM_PROMPT =
  "Ты помогаешь русскоязычным людям учить английский. Отвечай строго одним JSON-объектом, без пояснений и без markdown.";

export function buildPrompt(term: string, translationHint?: string): string {
  return [
    `Английское слово или фраза: "${term}".`,
    translationHint ? `Пользователь имеет в виду значение "${translationHint}" — опиши именно его.` : "",
    'Верни JSON: {"translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "..."}, где',
    "translation — краткий перевод на русский (1–3 самых частых значения через запятую),",
    "explanation — объяснение значения на русском в одном предложении,",
    "example — короткое естественное предложение на английском с этим словом,",
    TRANSCRIPTION_HINT,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseEnrichment(text: string): Enrichment {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`No JSON in LLM response: ${text.slice(0, 200)}`);
  return enrichmentSchema.parse(JSON.parse(text.slice(start, end + 1)));
}

const extractedItemSchema = z.object({ ...enrichmentFields, term: z.string().trim().min(1) }).transform(toEnrichment);

export function buildExtractPrompt(text: string): string {
  return [
    "Ниже английский текст ИЛИ список слов и фраз, которые пользователь выписал сам. Определи, что это.",
    "Строки могут начинаться с префикса экспорта чата вроде «[14/10/2026 21:31] Имя:» — это не часть фразы, игнорируй его.",
    "Если это список (по пункту на строку) — возьми каждый пункт, ничего не пропускай и не сокращай фразу до одного слова;",
    "глагольную форму можно привести к начальной (snagging yourself a peerage → snag yourself a peerage), но смысл фразы сохрани.",
    "Если это связный текст — выдели то, что стоит выучить русскоязычному человеку: фразовые глаголы, идиомы,",
    "устойчивые выражения и не самые базовые слова, пропусти очевидное (the, is, go, имена собственные).",
    `Не больше ${MAX_EXTRACT} пунктов, без повторов.`,
    'Верни JSON-массив: [{"term": "...", "translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "..."}], где',
    "translation — краткий перевод на русский в значении из текста, explanation — одно предложение на русском,",
    "example — короткое предложение на английском,",
    TRANSCRIPTION_HINT,
    "",
    "Текст:",
    text,
  ].join("\n");
}

/** Невалидные пункты отбрасываются; если в ответе вообще нет массива — бросает. */
export function parseExtraction(text: string): ExtractedItem[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(`No JSON array in LLM response: ${text.slice(0, 200)}`);
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("LLM response is not an array");
  return raw
    .map((entry) => extractedItemSchema.safeParse(entry))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, MAX_EXTRACT);
}

const checkSchema = z.object({
  corrected: z.string(),
  fixes: z
    .array(z.object({ wrong: z.string(), right: z.string(), why: z.string().default("") }))
    .default([]),
  natural: z.string().trim().default(""),
});

export function buildCheckPrompt(text: string): string {
  return [
    "Проверь английский текст, который написал русскоязычный человек.",
    "1) Исправь все грамматические, орфографические и лексические ошибки. Не трогай то, что и так правильно.",
    "2) Если фраза звучит не по-английски (калька с русского, странный порядок слов, неуместное слово), предложи вариант естественнее.",
    "Не предлагай его ради мелочей — сокращений вроде we're, синонимов, «a bit» вместо «a little bit». Если фраза и так звучит нормально, оставь пустую строку.",
    "Пунктуацию и регистр в разговорных сообщениях не считай ошибкой, если смысл не страдает.",
    'Верни JSON: {"corrected": "...", "fixes": [{"wrong": "...", "right": "...", "why": "..."}], "natural": "..."}, где',
    "corrected — исправленный текст, в котором изменённые слова обёрнуты в **двойные звёздочки** (если ошибок нет — исходный текст),",
    "fixes — список ошибок (пусто, если их нет), why — короткое объяснение правила на русском,",
    "natural — более естественный вариант всей фразы или пустая строка.",
    "",
    "Текст:",
    text,
  ].join("\n");
}

export function parseCheck(text: string): CheckResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`No JSON in LLM response: ${text.slice(0, 200)}`);
  return checkSchema.parse(JSON.parse(text.slice(start, end + 1)));
}
