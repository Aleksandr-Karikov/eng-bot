// Кадры приветственного видео: scenes.html рисует любой момент через window.render(t), здесь — по кадру в ffmpeg.
//   node record.mjs <out dir>            — frames.mp4
//   node record.mjs <out dir> 3,12,24   — кадры-превью still-<t>.jpg
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const [, , dir, times] = process.argv;
const mode = times ? "still" : "video";
const HERE = new URL(".", import.meta.url).pathname;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 30;
const timeline = readFileSync(`${dir}/timeline.json`, "utf8");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("pageerror:", e.stack));
await page.evaluateOnNewDocument(`window.TIMELINE = ${timeline};`);
await page.goto(`file://${HERE}scenes.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => window.TOTAL);
console.log("total", total.toFixed(2), "s");
if (mode === "still") {
  for (const t of times.split(",")) {
    await page.evaluate((x) => window.render(x), +t);
    await page.screenshot({ path: `${dir}/still-${t}.jpg`, type: "jpeg", quality: 85 });
  }
} else {
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", `${dir}/frames.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  const n = Math.ceil(total * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((x) => window.render(x), i / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 300 === 0) console.log("frame", i, "/", n);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
