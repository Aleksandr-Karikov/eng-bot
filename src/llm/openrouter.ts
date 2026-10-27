import type { ImageInput } from "./enricher";
import type { LlmBackend } from "./backend";
import type { Language } from "../lang";
import { systemPrompt } from "./enricher";

/**
 * Ходит в OpenRouter — OpenAI-совместимый `/api/v1/chat/completions` с ключом в заголовке.
 *
 * Отличия от Claude Code, которые здесь учтены:
 * - системный промпт — отдельным сообщением `system`, а не параметром (и он уходит на языке операции);
 * - картинки — content-массивом `image_url` с data-URL;
 * - имена моделей свои (`anthropic/claude-haiku-5.5`): алиасы Claude Code (`haiku`, `sonnet`)
 *   OpenRouter не понимает, поэтому модель сюда приходит уже выбранной (см. `models.ts`).
 */
export class OpenRouterBackend implements LlmBackend {
  readonly name = "openrouter";

  constructor(
    private readonly opts: {
      apiKey: string;
      /** Необязательные заголовки атрибуции OpenRouter; пустые не отправляются. */
      referer?: string;
      title?: string;
      /** Подменяется в тестах. */
      fetchImpl?: typeof fetch;
    },
  ) {}

  async ask(prompt: string, timeoutMs: number, model: string, images: ImageInput[], lang: Language): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (this.opts.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
          ...(this.opts.referer ? { "HTTP-Referer": this.opts.referer } : {}),
          ...(this.opts.title ? { "X-Title": this.opts.title } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          messages: [
            { role: "system", content: systemPrompt(lang) },
            { role: "user", content: images.length ? contentWithImages(prompt, images) : prompt },
          ],
        }),
      });
      // Тело читаем всегда: OpenRouter кладёт причину отказа в error.message даже при 200 с пустым выбором.
      const body = (await response.json().catch(() => undefined)) as
        | { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: unknown } }
        | undefined;
      if (!response.ok) {
        const reason = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
        // 401/402 — ключ или баланс: это чинится настройкой, а не повтором, и должно быть видно в логе как есть.
        throw new Error(`OpenRouter failed: ${reason}`);
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content === "") {
        const reason = typeof body?.error?.message === "string" ? body.error.message : "empty answer";
        throw new Error(`OpenRouter returned no answer: ${reason}`);
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Картинки у OpenAI-совместимых API идут data-URL'ами прямо в контенте сообщения. */
function contentWithImages(text: string, images: ImageInput[]): unknown[] {
  return [
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.data.toString("base64")}` },
    })),
    { type: "text", text },
  ];
}
