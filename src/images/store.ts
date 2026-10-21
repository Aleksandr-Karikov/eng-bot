import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type PictureKey = { id: number; term: string; translation: string };

/**
 * Картинки, нарисованные заранее (в фоне), — до первой отправки в Telegram.
 * Имя файла содержит отпечаток слова и перевода: после /edit старая картинка просто перестаёт подходить.
 */
export class PictureStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private fileName(word: PictureKey): string {
    const hash = createHash("sha1").update(`${word.term}\n${word.translation}`).digest("hex").slice(0, 12);
    return `${word.id}-${hash}.jpg`;
  }

  find(word: PictureKey): string | undefined {
    const path = join(this.dir, this.fileName(word));
    if (existsSync(path)) return path;
    // Старые, ещё не пережатые (scripts/compress-pictures.ts переводит их в JPEG).
    const png = path.replace(/\.jpg$/, ".png");
    return existsSync(png) ? png : undefined;
  }

  async save(word: PictureKey, png: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, this.fileName(word)), png);
  }

  /** Удаляет картинки, которые не подходят ни одному из текущих слов (слово удалили или изменили). */
  async prune(words: PictureKey[]): Promise<void> {
    if (!existsSync(this.dir)) return;
    const keep = new Set(words.map((w) => this.fileName(w)));
    for (const file of await readdir(this.dir)) {
      const asJpg = file.replace(/\.png$/, ".jpg");
      if (/\.(png|jpg)$/.test(file) && !keep.has(asJpg)) await rm(join(this.dir, file), { force: true });
    }
  }
}
