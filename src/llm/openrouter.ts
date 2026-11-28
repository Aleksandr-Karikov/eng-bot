import { setTimeout as wait } from "node:timers/promises";
import type { ImageInput } from "./enricher";
import type { LlmBackend } from "./backend";
import type { Language } from "../lang";
import { systemPrompt } from "./enricher";
import { ModelRequestError } from "./errors";

type UpstreamError = { code?: unknown; message?: unknown; metadata?: { reason?: unknown } };
type Completion = {
  error?: UpstreamError;
  choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown; error?: UpstreamError }>;
};

const RETRY_DELAY_MS = 750;

function retryAfterMs(header: string | null | undefined): number {
  if (!header) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

async function readAnswer(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as Completion | undefined;
  const choice = body?.choices?.[0];
  const error = body?.error ?? choice?.error;
  if (response.ok && (choice?.finish_reason === "content_filter" || choice?.message?.refusal)) {
    throw new ModelRequestError("OpenRouter returned no answer: filtered", "content_filter");
  }
  const retryAfter = retryAfterMs(response.headers?.get("Retry-After"));
  if (!response.ok || error || choice?.finish_reason === "error") {
    const providerStatus = typeof error?.code === "number" && error.code >= 400 && error.code < 600 ? error.code : undefined;
    const status = response.ok ? (providerStatus ?? (choice?.finish_reason === "error" ? 502 : undefined)) : response.status;
    const reason = typeof error?.message === "string" ? error.message : status ? `HTTP ${status}` : "provider error";
    const prefix = response.ok ? "OpenRouter returned no answer" : "OpenRouter failed";
    const budget = status === 402 && error?.metadata?.reason === "in_flight_budget_exhausted";
    const code = budget ? "in_flight_budget" : status ? `${response.ok ? "provider" : "http"}_${status}` : "provider_error";
    const temporary = budget || (status !== undefined && (status === 408 || status === 429 || status >= 500));
    throw new ModelRequestError(`${prefix}: ${reason}`, code, temporary, retryAfter);
  }
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  const truncated = choice?.finish_reason === "length";
  const code = truncated ? "empty_truncated_reply" : body === undefined ? "invalid_transport_json" : "empty_reply";
  throw new ModelRequestError("OpenRouter returned no answer: empty answer", code, !truncated, retryAfter);
}

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

  /**
   * `_lang` — часть контракта `LlmBackend` (тест закрепляет, что бэкенд получает английский), но
   * самому провайдеру язык не нужен: промпт уже собран на нужном языке выше.
   */
  async ask(prompt: string, timeoutMs: number, model: string, images: ImageInput[], _lang: Language): Promise<string> {
    const controller = new AbortController();
    const request: RequestInit = {
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
        // Запас на полный результат /text с MAX_EXTRACT пунктами и JSON-обёрткой (E27).
        max_tokens: 16000,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: images.length ? contentWithImages(prompt, images) : prompt },
        ],
      }),
    };
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const send = async () => {
      const response = await (this.opts.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", request)
        .catch((err: unknown) => {
          if (err instanceof TypeError) throw new ModelRequestError("OpenRouter network error", "network", true);
          throw err;
        });
      return readAnswer(response);
    };
    try {
      try {
        return await send();
      } catch (err) {
        if (!(err instanceof ModelRequestError) || !err.retryable || controller.signal.aborted) throw err;
        const delay = Math.max(RETRY_DELAY_MS, err.retryAfterMs);
        if (Date.now() + delay >= deadline) throw err;
        console.warn("OpenRouter retry", model, err.code);
        await wait(delay, undefined, { signal: controller.signal });
        const answer = await send();
        console.info("OpenRouter retry succeeded", model, err.code);
        return answer;
      }
    } catch (err) {
      if (controller.signal.aborted) throw new ModelRequestError("OpenRouter request aborted by timeout", "timeout");
      throw err;
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
