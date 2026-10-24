import { currentLang } from "../lang";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Accent } from "./tts";
import { JsonLineWorker } from "./worker";

const run = promisify(execFile);

/** Кусок сравнения звуков: equal — совпало, replace / delete / insert — сказано не так, пропущено, лишнее. */
export interface PhonemeDiff {
  op: "equal" | "replace" | "delete" | "insert";
  expected: string[];
  heard: string[];
}

export interface Pronunciation {
  /** Звуки, которые услышала модель фонем (IPA). */
  heard: string[];
  /** Эталон из espeak тем же алфавитом. */
  expected: string[];
  /** Доля совпавших звуков, 0–1. */
  score: number;
  diff: PhonemeDiff[];
  /** С каким акцентом сравнивали (при any — ближайший). */
  accent: Accent;
}

/** Распознавание голосовых (OGG/Opus из Telegram или любой звук, который понимает ffmpeg). */
export interface SpeechRecognizer {
  /** Текст речи, по-английски. */
  transcribe(audio: Buffer): Promise<string>;
  /**
   * Какими звуками произнесено и чем отличается от эталона для text; any — ближайший из UK и US.
   * refs — то же, сказанное диктором: эталоном служит и то, что модель слышит у него.
   */
  pronunciation(audio: Buffer, text: string, accent: Accent | "any", refs?: Array<{ accent: Accent; audio: Buffer }>): Promise<Pronunciation>;
}

/** Модели грузятся при первом запросе (а в самый первый раз — скачиваются, ~2 ГБ). */
const START_TIMEOUT_MS = 600_000;
const REQUEST_TIMEOUT_MS = 120_000;

/** Whisper (mlx) + модель фонем wav2vec2 — локально, процесс tools/stt/stt_server.py. */
export class LocalRecognizer implements SpeechRecognizer {
  private readonly worker: JsonLineWorker;

  constructor(python: string, script: string) {
    this.worker = new JsonLineWorker("STT", python, script, START_TIMEOUT_MS);
  }

  async transcribe(audio: Buffer): Promise<string> {
    const language = currentLang().whisper;
    return this.withWavs([audio], async ([wav]) => String((await this.worker.request({ op: "transcribe", wav, language }, REQUEST_TIMEOUT_MS)).text ?? ""));
  }

  async pronunciation(audio: Buffer, text: string, accent: Accent | "any", refs: Array<{ accent: Accent; audio: Buffer }> = []): Promise<Pronunciation> {
    return this.withWavs([audio, ...refs.map((r) => r.audio)], async ([wav, ...refWavs]) => {
      const body = { op: "phonemes", wav, text, accent, refs: refs.map((r, i) => ({ accent: r.accent, wav: refWavs[i] })) };
      return (await this.worker.request(body, REQUEST_TIMEOUT_MS)) as unknown as Pronunciation;
    });
  }

  close(): void {
    this.worker.close();
  }

  /** Модели ждут 16 кГц моно. */
  private async withWavs<T>(audios: Buffer[], use: (wavs: string[]) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-stt-"));
    try {
      const wavs = await Promise.all(
        audios.map(async (audio, i) => {
          const input = join(dir, `voice-${i}.ogg`);
          const wav = join(dir, `voice-${i}.wav`);
          await writeFile(input, audio);
          await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", wav], { timeout: 20_000 });
          return wav;
        }),
      );
      return await use(wavs);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
