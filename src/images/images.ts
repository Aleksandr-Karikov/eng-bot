import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExerciseTutor } from "../llm/tutor";

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
 * Картинки-ассоциации к словам: Claude превращает запоминалку в описание сцены, рисовалка — в картинку.
 * Рисуется строго по одной (две копии модели не поместятся в память), и не больше одного раза на слово одновременно.
 */
export class ImageService {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private readonly inFlight = new Map<number, Promise<Buffer>>();

  constructor(
    private readonly synth: ImageSynth,
    private readonly tutor: ExerciseTutor,
  ) {}

  /** Сколько картинок сейчас рисуется или ждёт очереди. */
  get queued(): number {
    return this.waiting;
  }

  drawWord(word: { id: number; term: string; translation: string; mnemonic: string }): Promise<Buffer> {
    const running = this.inFlight.get(word.id);
    if (running) return running;
    const task = (async () => {
      const prompt = await this.tutor.imagePrompt(word.term, word.translation, word.mnemonic);
      return this.enqueue(() => this.synth.draw(prompt));
    })().finally(() => this.inFlight.delete(word.id));
    this.inFlight.set(word.id, task);
    return task;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.waiting++;
    const result = this.chain.catch(() => {}).then(job);
    this.chain = result.catch(() => {});
    return result.finally(() => this.waiting--);
  }
}
