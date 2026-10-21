/**
 * Переводит уже нарисованные картинки (data/images/*.png) в сжатый JPEG — как теперь сохраняются новые.
 *   npx tsx scripts/compress-pictures.ts [--dry-run]
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compressPicture } from "../src/images/compress";

const dir = "data/images";
const dryRun = process.argv.includes("--dry-run");
let before = 0;
let after = 0;
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".png"))) {
  const png = await readFile(join(dir, file));
  const jpeg = await compressPicture(png);
  before += png.length;
  after += jpeg.length;
  if (!dryRun) {
    await writeFile(join(dir, file.replace(/\.png$/, ".jpg")), jpeg);
    await rm(join(dir, file));
  }
}
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
console.log(`${mb(before)} → ${mb(after)}${dryRun ? " (dry run)" : ""}`);
void stat;
