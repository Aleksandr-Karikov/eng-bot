import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { currentLang, withLang, type LangCode } from "../lang";
import type { ExerciseTutor } from "../llm/tutor";
import { compressPicture } from "./compress";

const run = promisify(execFile);

/** Рисует картинку по английскому описанию сцены, PNG. */
export interface ImageSynth {
  draw(prompt: string): Promise<Buffer>;
}

/** Локальный FLUX.1-schnell (4-bit, MLX) через mflux. ~20 с на картинку на M3 Pro, пик памяти ~12 ГБ. */
export class FluxSynth implements ImageSynth {
  private readonly mfluxBin: string;

  /** Относительный путь считается от папки бота: процесс генерации запускается во временном каталоге. */
  constructor(mfluxBin: string) {
    this.mfluxBin = resolve(mfluxBin);
  }

  async draw(prompt: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-img-"));
    try {
      const out = join(dir, "picture.png");
      // execFile без shell: описание сцены — отдельный аргумент, его нельзя «выполнить».
      await run(
        this.mfluxBin,
        [
          "--model", "dhairyashil/FLUX.1-schnell-mflux-4bit", "--base-model", "schnell",
          "--steps", "2", "--seed", String(Math.floor(Math.random() * 1e6)),
          "--width", "512", "--height", "512",
          "--prompt", prompt, "--output", out,
        ],
        { timeout: 180_000, cwd: dir },
      );
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Рисует картинку внешним API (OpenRouter) — то, что нужно на Linux, где локальный MLX не работает.
 *
 * Ответ приходит не текстом, а картинкой: нужен `modalities: ["image", "text"]`, иначе модель ответит
 * описанием вместо картинки. Картинка лежит в `choices[0].message.images[0].image_url.url` как data-URL
 * (base64), а не отдельным полем — формат OpenAI-совместимый, но с расширением OpenRouter.
 */
export class ApiSynth implements ImageSynth {
  constructor(
    private readonly opts: {
      apiKey: string;
      model: string;
      /** Необязательные заголовки атрибуции OpenRouter, как у текстового бэкенда. */
      referer?: string;
      title?: string;
      timeoutMs?: number;
      /** Подменяется в тестах. */
      fetchImpl?: typeof fetch;
    },
  ) {}

  async draw(prompt: string): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
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
          model: this.opts.model,
          modalities: ["image", "text"],
          messages: [{ role: "user", content: prompt }],
        }),
      });
      // Тело читаем всегда: причина отказа лежит в error.message даже при 200 без картинки.
      const body = (await response.json().catch(() => undefined)) as
        | { choices?: Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: unknown } }> } }>; error?: { message?: unknown } }
        | undefined;
      if (!response.ok) {
        const reason = typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
        // 401/402 — ключ или баланс: чинится настройкой, а не повтором, и должно быть видно в логе как есть.
        throw new Error(`Image API failed: ${reason}`);
      }
      const url = body?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      // Ответ 0.5–2 МБ: раскодируем сразу в буфер и data-URL дальше не тащим.
      // Модель отвечает текстом вместо картинки, когда промпт читается как «опиши», а не «нарисуй»
      // (проверено: готовая сцена рисуется, а русская инструкция «придумай картинку» — нет).
      // Поэтому в ошибку кладём начало ответа: иначе непонятно, что именно ушло не так.
      if (typeof url !== "string") {
        const said = body?.choices?.[0]?.message?.content;
        const hint = typeof said === "string" && said ? `, it answered with text: ${said.slice(0, 120)}` : "";
        throw new Error(`Image API returned no picture${hint}`);
      }
      const base64 = url.startsWith("data:") ? url.slice(url.indexOf(",") + 1) : url;
      if (!base64) throw new Error("Image API returned an empty picture");
      return Buffer.from(base64, "base64");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Картинки-ассоциации к словам: Claude превращает запоминалку в описание сцены, рисовалка — в картинку.
 * Рисуется строго по одной (две копии модели не поместятся в память), и не больше одного раза на слово одновременно.
 */
/** Стили, которые сравнивали по образцам; первый — по умолчанию (контрастный чернильный комикс). */
export const STYLE_PRESETS = [
  { label: "Комикс", style: "black ink comic, bold lines, halftone shading, one accent color red, no text" },
  { label: "Акварель", style: "watercolor storybook illustration, soft textured paper, gentle colors, no text" },
  { label: "3D", style: "3d render, pixar style, soft studio lighting, cute characters, no text" },
  { label: "Пластилин", style: "claymation, plasticine figures, handmade look, warm light, no text" },
  { label: "Вектор", style: "flat vector illustration, minimal, soft pastel colors, clean shapes, no text" },
  { label: "Набросок", style: "simple pencil sketch, hand-drawn doodle on notebook paper, no text" },
] as const;

export const DEFAULT_IMAGE_STYLE: string = STYLE_PRESETS[0].style;

export class ImageService {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly synth: ImageSynth,
    private readonly tutor: ExerciseTutor,
    /** Стиль дописывается к сцене от Claude (IMAGE_STYLE в .env). */
    private readonly style = DEFAULT_IMAGE_STYLE,
    /** Язык слова по его комнате: картинки рисуются и в фоне, вне контекста запроса. Нет — язык текущей операции. */
    private readonly languageOf?: (wordId: number) => Promise<LangCode>,
  ) {}

  /** Сколько картинок сейчас рисуется или ждёт очереди. */
  get queued(): number {
    return this.waiting;
  }

  /** opts.style — другой стиль, opts.wish — пожелание ученика к сцене (для «Перерисовать»). */
  drawWord(
    word: { id: number; term: string; translation: string; explanation: string; example: string },
    opts: { style?: string; wish?: string } = {},
  ): Promise<Buffer> {
    const key = `${word.id}\n${opts.style ?? ""}\n${opts.wish ?? ""}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const task = (async () => {
      const lang = this.languageOf ? await this.languageOf(word.id) : currentLang().code;
      const prompt = await withLang(lang, () => this.tutor.imagePrompt({ ...word, ...(opts.wish ? { wish: opts.wish } : {}) }));
      const png = await this.enqueue(() => this.synth.draw(`${prompt}, ${opts.style ?? this.style}`));
      // Сразу сжимаем: дальше картинка и уходит в Telegram, и хранится, и отдаётся в Mini App уже лёгкой.
      return compressPicture(png);
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.waiting++;
    const result = this.chain.catch(() => {}).then(job);
    this.chain = result.catch(() => {});
    return result.finally(() => this.waiting--);
  }
}
