import { z } from "zod";

/**
 * JSON из ответа модели. Обычно он один, но модель иногда «передумывает» и пишет второй вариант
 * или оборачивает ответ в пояснения — берём первый целый объект (массив), который разбирается.
 */
function extract(text: string, open: string, close: string, what: string): unknown {
  const end = text.lastIndexOf(close);
  for (let start = text.indexOf(open); start !== -1 && start < end; start = text.indexOf(open, start + 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Не с этой скобки — пробуем следующую.
    }
  }
  throw new Error(`No JSON ${what} in LLM response: ${text.slice(0, 200)}`);
}

export const jsonObject = (text: string): unknown => extract(text, "{", "}", "object");

export function jsonArray(text: string): unknown[] {
  const raw = extract(text, "[", "]", "array");
  if (!Array.isArray(raw)) throw new Error("LLM response is not an array");
  return raw;
}

/** Ошибка в тексте ученика — одна схема для /check, своего предложения, разговора и перевода. */
export const fixSchema = z.object({
  wrong: z.string(),
  right: z.string(),
  why: z.string().default(""),
  category: z.string().trim().default(""),
  slip: z.boolean().default(false),
});

export const fixesField = z.array(fixSchema).default([]);
