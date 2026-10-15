import { z } from "zod";

export interface Enrichment {
  translation: string;
  explanation: string;
  example: string;
}

export interface WordEnricher {
  enrich(term: string, translationHint?: string): Promise<Enrichment>;
}

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
