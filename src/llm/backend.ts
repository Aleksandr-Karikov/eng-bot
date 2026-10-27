import type { ImageInput } from "./enricher";
import type { Language } from "../lang";

/**
 * Провайдер LLM — ровно то, чем провайдеры отличаются друг от друга: один запрос «промпт → текст».
 *
 * Всё остальное (какой промпт собрать, как разобрать ответ, какая модель для чего) живёт в
 * `enricher.ts` / `tutor.ts` и одинаково для всех провайдеров. Поэтому второй провайдер — это
 * вторая реализация одного метода, а не второй класс на 700 строк.
 *
 * Язык передаётся параметром, а не берётся из `currentLang()` внутри: роутер (см. `provider.ts`)
 * читает язык в момент вызова, когда контекст ещё на месте.
 */
export interface LlmBackend {
  /** Имя для логов и интерфейса: "claude-code" | "openrouter". */
  readonly name: string;
  /** Один запрос; возвращает текст ответа. Бросает — при таймауте, ошибке сети, отказе модели. */
  ask(prompt: string, timeoutMs: number, model: string, images: ImageInput[], lang: Language): Promise<string>;
}
