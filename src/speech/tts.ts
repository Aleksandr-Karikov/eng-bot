import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Accent = "uk" | "us";

/** Озвучка слова или фразы в OGG/Opus — формат голосовых сообщений Telegram. */
export interface SpeechSynth {
  /** format: ogg (Opus) — для голосовых Telegram; m4a (AAC) — для браузера Mini App (Safari не играет Ogg). */
  synthesize(text: string, accent: Accent, format?: "ogg" | "m4a"): Promise<Buffer>;
}

const VOICES: Record<Accent, string> = { uk: "Daniel", us: "Samantha" };

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
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-tts-"));
    try {
      const input = join(dir, "text.txt");
      const aiff = join(dir, "speech.aiff");
      const out = join(dir, `speech.${format}`);
      await writeFile(input, speakableText(text), "utf8");
      await run("say", ["-v", VOICES[accent], "-f", input, "-o", aiff], { timeout: 20_000 });
      await encode(aiff, out, format);
      return await readFile(out);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Звук → OGG/Opus (голосовые Telegram) или M4A/AAC (браузер). */
async function encode(input: string, out: string, format: "ogg" | "m4a"): Promise<void> {
  const codec = format === "ogg" ? ["-c:a", "libopus", "-b:a", "32k"] : ["-c:a", "aac", "-b:a", "64k"];
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, ...codec, out], { timeout: 20_000 });
}

/** Первый запуск грузит модель (а в самый первый раз — скачивает); фраза — доли секунды. */
const START_TIMEOUT_MS = 180_000;
const PHRASE_TIMEOUT_MS = 30_000;

/**
 * Нейросетевые голоса Kokoro (tools/tts): заметно естественнее `say`. Работает отдельным постоянным процессом
 * на Python, чтобы модель грузилась один раз; фразы идут ему по одной строкой JSON. Если процесс не запустился
 * или упал — эта фраза озвучивается запасным синтезом (`say`), а процесс перезапускается со следующей.
 */
export class KokoroSynth implements SpeechSynth {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();

  constructor(
    private readonly python: string,
    private readonly script: string,
    private readonly fallback: SpeechSynth,
  ) {}

  async synthesize(text: string, accent: Accent, format: "ogg" | "m4a" = "ogg"): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-kokoro-"));
    try {
      const wav = join(dir, "speech.wav");
      const out = join(dir, `speech.${format}`);
      await this.speak(speakableText(text), accent, wav);
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
    this.proc?.kill();
  }

  private async speak(text: string, accent: Accent, out: string): Promise<void> {
    await this.start();
    const id = ++this.seq;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Kokoro timeout"));
      }, PHRASE_TIMEOUT_MS);
      this.waiting.set(id, {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (err) => (clearTimeout(timer), reject(err)),
      });
      this.proc!.stdin.write(`${JSON.stringify({ id, text, accent, out })}\n`);
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const proc = spawn(this.python, [this.script], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Kokoro did not start")), START_TIMEOUT_MS);
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg: { ready?: boolean; id?: number; ok?: boolean; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) {
          clearTimeout(timer);
          return resolve();
        }
        const waiter = msg.id !== undefined ? this.waiting.get(msg.id) : undefined;
        if (!waiter) return;
        this.waiting.delete(msg.id!);
        if (msg.ok) waiter.resolve();
        else waiter.reject(new Error(msg.error ?? "Kokoro error"));
      });
      // Предупреждения библиотек — в stderr; в лог бота только последнее, если процесс упал.
      let lastErr = "";
      proc.stderr.on("data", (chunk: Buffer) => (lastErr = chunk.toString().slice(-500)));
      proc.on("exit", (code) => {
        clearTimeout(timer);
        const err = new Error(`Kokoro exited (${code}): ${lastErr.trim()}`);
        reject(err);
        for (const w of this.waiting.values()) w.reject(err);
        this.waiting.clear();
        // Следующая фраза запустит процесс заново.
        if (this.proc === proc) {
          this.proc = undefined;
          this.ready = undefined;
        }
      });
    });
    // Не запустился — сбросить, чтобы попробовать снова со следующей фразой.
    this.ready.catch(() => {
      if (this.proc === proc) {
        proc.kill();
        this.proc = undefined;
        this.ready = undefined;
      }
    });
    return this.ready;
  }
}
