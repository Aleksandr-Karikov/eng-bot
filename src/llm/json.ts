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

/**
 * Массив из ответа модели — с спасением обрезанного.
 *
 * Модель может не уложиться в `max_tokens` и оборвать ответ посередине объекта. Раньше такой ответ
 * терялся целиком: `extract` искал последнюю `]`, не находил её и бросал «нет JSON», человек видел
 * «не получилось разобрать», хотя первые пункты были целыми, а попытка уже списана (E27).
 *
 * Теперь при неудаче режем по последнему **завершённому** объекту: находим последнюю `}` и пробуем
 * закрыть массив за ней. Так сохраняется всё, что модель успела написать, — лучше часть, чем ничего.
 * Порядок важен: сначала честный разбор целого ответа, и только потом спасение.
 */
export function jsonArray(text: string): unknown[] {
  try {
    const raw = extract(text, "[", "]", "array");
    if (!Array.isArray(raw)) throw new Error("LLM response is not an array");
    return raw;
  } catch (err) {
    // Не разобралось — ответ мог быть обрезан. Ищем последний целый объект внутри массива.
    const salvaged = salvageTruncatedArray(text);
    if (salvaged) return salvaged;
    throw err;
  }
}

/** Сколько пунктов удалось спасти из обрезанного массива; null — спасать нечего. */
function salvageTruncatedArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  if (start < 0) return null;
  // Идём от последней `}` назад: каждая попытка — «закрыть массив сразу после этого объекта».
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      const candidate: unknown = JSON.parse(`${text.slice(start, end + 1)}]`);
      if (Array.isArray(candidate) && candidate.length > 0) return candidate as unknown[];
    } catch {
      // Этот объект тоже неполный — пробуем предыдущий.
    }
  }
  return null;
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
