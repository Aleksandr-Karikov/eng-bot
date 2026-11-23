// Проверка панели субтитров на разметке, как у YouTube: окно субтитров поверх нижней части видео,
// реплика набирается сегментами по буквам. Так ловится регрессия «в панели только последний кусок»
// и «история забита обрывками, назад не полистать».
//   node tools/extension/subtitles-check.mjs
// Нужен установленный Chrome и puppeteer-core из этого репозитория (сеть не нужна).
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = new URL("../../extension/", import.meta.url).pathname;

const HTML = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #111; }
  #movie_player { position: relative; width: 900px; height: 506px; margin: 40px; background: #000; overflow: hidden; }
  video { position: absolute; inset: 0; width: 900px; height: 506px; display: block; background: #222; }
  /* Контейнер субтитров растянут на весь плеер, окно — у нижнего края. */
  .caption-window-container { position: absolute; inset: 0; pointer-events: none; }
  .caption-window { position: absolute; bottom: 10%; left: 10%; right: 10%; text-align: center; color: #fff; font: 24px/1.4 sans-serif; }
</style>
<div id="movie_player">
  <video></video>
  <div class="caption-window-container">
    <div class="caption-window"><span class="captions-text" id="cc-text"><span class="caption-visual-line" id="cc-line"></span></span></div>
  </div>
</div>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(HTML);
await page.addStyleTag({ path: `${EXT}content.css` });
await page.addScriptTag({ path: `${EXT}content.js` });
await page.waitForSelector("#wordboss-panel", { timeout: 5000 });

/** Реплика пришла целиком и набирается сегмент за сегментом, по одной букве. */
async function speak(segments) {
  await page.evaluate(() => {
    const line = document.getElementById("cc-line");
    line.innerHTML = "";
    line.append(Object.assign(document.createElement("span"), { className: "ytp-caption-segment" }));
  });
  for (let s = 0; s < segments.length; s++) {
    if (s > 0) await page.evaluate(() => document.getElementById("cc-line").append(Object.assign(document.createElement("span"), { className: "ytp-caption-segment" })));
    const span = (await page.$$("#cc-line .ytp-caption-segment"))[s];
    for (const ch of segments[s]) {
      await span.evaluate((el, c) => (el.textContent += c), ch);
      await new Promise((r) => setTimeout(r, 4));
    }
  }
  await new Promise((r) => setTimeout(r, 120));
}

const visible = () => page.evaluate(() => document.querySelector("#wordboss-panel .wb-line")?.textContent?.trim() ?? "");
const prevDisabled = () => page.evaluate(() => document.querySelector("#wordboss-panel .wb-prev")?.disabled ?? true);

/** Что панель запомнила: листаем ◀ до упора. */
async function history() {
  const out = [await visible()];
  while (!(await prevDisabled())) {
    await page.click("#wordboss-panel .wb-prev");
    out.push(await visible());
  }
  await page.mouse.move(5, 5); // курсор с панели: пока он на ней, реплика «замерзает»
  return out;
}

let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`}`);
};

await speak(["I don't", " know"]);
check("реплика из сегментов — целиком", await visible(), "I don't know");

await speak(["just", " what", " you mean"]);
check("вторая реплика — целиком, без кусков первой", await visible(), "just what you mean");
check("по строке на реплику, без обрывков", await history(), ["just what you mean", "I don't know"]);

for (let i = 1; i <= 25; i++) await speak([`Line ${i} of the show`]);
const deep = await history();
check("назад листается хотя бы 25 реплик", deep.length >= 26, true);
check("в глубине — целые реплики", deep.at(-1), "I don't know");

await browser.close();
process.exit(bad ? 1 : 0);
