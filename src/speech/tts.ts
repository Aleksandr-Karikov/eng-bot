import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { currentLang } from "../lang";
import { JsonLineWorker } from "./worker";

const run = promisify(execFile);

export type Accent = "uk" | "us";

/** Озвучка слова или фразы в OGG/Opus — формат голосовых сообщений Telegram. */
export interface SpeechSynth {
  /** format: ogg (Opus) — для голосовых Telegram; m4a (AAC) — для браузера Mini App (Safari не играет Ogg). */
  synthesize(text: string, accent: Accent, format?: "ogg" | "m4a"): Promise<Buffer>;
}

const VOICES: Record<Accent, string> = { uk: "Daniel", us: "Samantha" };
/** Русский голос macOS — для переводов в аудиоуроке (в Kokoro русского нет). */
export const RUSSIAN_VOICE = "Milena";

/** `say` понимает встроенные команды [[...]] (паузы, голос) — из слова пользователя их убираем. */
export function speakableText(text: string): string {
  return text.replace(/\[\[|\]\]/g, "");
}

/**
 * Встроенный синтез macOS (`say`) + `ffmpeg`. Текст передаётся файлом, а не аргументом,
 * чтобы фраза вида "-o x" не стала параметром команды. На Linux заменить на Piper/espeak-ng.
 */
export class MacSaySynth implements SpeechSynth {
  async synthesize(text: string, accent: Accent, format: "ogg" | "m4a" = "ogg"): Promise<Buffer> {
    return macSay(text, VOICES[accent], format);
  }
}

/** Фраза голосом macOS (`voice` — имя голоса из `say -v '?'`). */
export async function macSay(text: string, voice: string, format: "ogg" | "m4a" = "ogg"): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "eng-bot-tts-"));
  try {
    const input = join(dir, "text.txt");
    const aiff = join(dir, "speech.aiff");
    const out = join(dir, `speech.${format}`);
    await writeFile(input, speakableText(text), "utf8");
    await run("say", ["-v", voice, "-f", input, "-o", aiff], { timeout: 20_000 });
    await encode(aiff, out, format);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Звук → OGG/Opus (голосовые Telegram) или M4A/AAC (браузер). */
async function encode(input: string, out: string, format: "ogg" | "m4a"): Promise<void> {
  const codec = format === "ogg" ? ["-c:a", "libopus", "-b:a", "32k"] : ["-c:a", "aac", "-b:a", "64k"];
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, ...codec, out], { timeout: 20_000 });
}

/**
 * Озвучка на языке текущей операции (lang.ts): английский — основным синтезом (Kokoro или say),
 * другие языки — голосом macOS этого языка (у Kokoro корейского нет).
 */
export class LanguageAwareSynth implements SpeechSynth {
  constructor(readonly english: SpeechSynth) {}

  synthesize(text: string, accent: Accent, format: "ogg" | "m4a" = "ogg"): Promise<Buffer> {
    const lang = currentLang();
    return lang.code === "en" ? this.english.synthesize(text, accent, format) : macSay(text, lang.macVoice[accent], format);
  }
}

/** Первый запуск грузит модель (а в самый первый раз — скачивает); фраза — доли секунды. */
const START_TIMEOUT_MS = 180_000;
const PHRASE_TIMEOUT_MS = 30_000;

/**
 * Нейросетевые голоса Kokoro (tools/tts): заметно естественнее `say`. Работает отдельным постоянным процессом
 * на Python, чтобы модель грузилась один раз. Если процесс не запустился или упал — эта фраза озвучивается
 * запасным синтезом (`say`), а процесс перезапускается со следующей.
 */
export class KokoroSynth implements SpeechSynth {
  private readonly worker: JsonLineWorker;

  constructor(
    python: string,
    script: string,
    private readonly fallback: SpeechSynth,
  ) {
    this.worker = new JsonLineWorker("Kokoro", python, script, START_TIMEOUT_MS);
  }

  async synthesize(text: string, accent: Accent, format: "ogg" | "m4a" = "ogg"): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-kokoro-"));
    try {
      const wav = join(dir, "speech.wav");
      const out = join(dir, `speech.${format}`);
      await this.worker.request({ text: speakableText(text), accent, out: wav }, PHRASE_TIMEOUT_MS);
      await encode(wav, out, format);
      return await readFile(out);
    } catch (err) {
      console.error("Kokoro failed, falling back to say", err instanceof Error ? err.message : err);
      return this.fallback.synthesize(text, accent, format);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Остановить процесс (при выключении бота). */
  close(): void {
    this.worker.close();
  }
}
