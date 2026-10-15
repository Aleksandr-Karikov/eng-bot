import { z } from "zod";

export interface Enrichment {
  translation: string;
  explanation: string;
  example: string;
}

export interface ExtractedItem extends Enrichment {
  term: string;
}

export interface WordEnricher {
  enrich(term: string, translationHint?: string): Promise<Enrichment>;
  /** Выделяет из текста или списка слова и фразы, полезные для изучения, сразу с переводом. */
  extract(text: string): Promise<ExtractedItem[]>;
}

/** В клавиатуре пачки слова листаются страницами, так что 100 пунктов укладываются в лимит кнопок Telegram. */
export const MAX_EXTRACT = 100;

const enrichmentSchema = z.object({
  translation: z.string().trim().min(1),
  explanation: z.string().trim().default(""),
  example: z.string().trim().default(""),
});

export const SYSTEM_PROMPT =
  "Ты помогаешь русскоязычным людям учить английский. Отвечай строго одним JSON-объектом, без пояснений и без markdown.";

export function buildPrompt(term: string, translationHint?: string): string {
  return [
    `Английское слово или фраза: "${term}".`,
    translationHint ? `Пользователь имеет в виду значение "${translationHint}" — опиши именно его.` : "",
    'Верни JSON: {"translation": "...", "explanation": "...", "example": "..."}, где',
    "translation — краткий перевод на русский (1–3 самых частых значения через запятую),",
    "explanation — объяснение значения на русском в одном предложении,",
    "example — короткое естественное предложение на английском с этим словом.",
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

const extractedItemSchema = enrichmentSchema.extend({ term: z.string().trim().min(1) });

export function buildExtractPrompt(text: string): string {
  return [
    "Ниже английский текст ИЛИ список слов и фраз, которые пользователь выписал сам. Определи, что это.",
    "Строки могут начинаться с префикса экспорта чата вроде «[14/10/2026 21:31] Имя:» — это не часть фразы, игнорируй его.",
    "Если это список (по пункту на строку) — возьми каждый пункт, ничего не пропускай и не сокращай фразу до одного слова;",
    "глагольную форму можно привести к начальной (snagging yourself a peerage → snag yourself a peerage), но смысл фразы сохрани.",
    "Если это связный текст — выдели то, что стоит выучить русскоязычному человеку: фразовые глаголы, идиомы,",
    "устойчивые выражения и не самые базовые слова, пропусти очевидное (the, is, go, имена собственные).",
    `Не больше ${MAX_EXTRACT} пунктов, без повторов.`,
    'Верни JSON-массив: [{"term": "...", "translation": "...", "explanation": "...", "example": "..."}], где',
    "translation — краткий перевод на русский в значении из текста, explanation — одно предложение на русском,",
    "example — короткое предложение на английском.",
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
