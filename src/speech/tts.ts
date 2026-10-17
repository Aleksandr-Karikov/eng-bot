import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Accent = "uk" | "us";

/** Озвучка слова или фразы в OGG/Opus — формат голосовых сообщений Telegram. */
export interface SpeechSynth {
  synthesize(text: string, accent: Accent): Promise<Buffer>;
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
  async synthesize(text: string, accent: Accent): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-tts-"));
    try {
      const input = join(dir, "text.txt");
      const aiff = join(dir, "speech.aiff");
      const ogg = join(dir, "speech.ogg");
      await writeFile(input, speakableText(text), "utf8");
      await run("say", ["-v", VOICES[accent], "-f", input, "-o", aiff], { timeout: 20_000 });
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-c:a", "libopus", "-b:a", "32k", ogg], { timeout: 20_000 });
      return await readFile(ogg);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
