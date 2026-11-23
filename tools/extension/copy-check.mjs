// Кнопка «Копировать» во вложенном cross-origin iframe — так панель живёт на чужом сайте («режим фильма»).
// Там браузер запрещает clipboard-write политикой разрешений, и обычный navigator.clipboard падает
// с NotAllowedError. Проверяем, что панель откатывается на execCommand и копирует нужный текст.
//   node tools/extension/copy-check.mjs
// Нужен установленный Chrome и puppeteer-core из этого репозитория. Два источника (127.0.0.1 и localhost)
// поднимаются внутри скрипта: localhost — плеер во фрейме, 127.0.0.1 — страница вокруг, origin'ы разные.
import { createServer } from "node:http";

import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = new URL("../../extension/", import.meta.url).pathname;
const PORT = 8792;

const INNER = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#111} video{width:880px;height:500px;display:block;background:#222}
.caption-window-container{position:absolute;inset:0;pointer-events:none}
.caption-window{position:absolute;bottom:12%;left:10%;right:10%;text-align:center;color:#fff;font:24px sans-serif}</style>
<video></video>
<div class="caption-window-container"><div class="caption-window"><span class="captions-text" id="cc-text"><span class="caption-visual-line" id="cc-line"></span></span></div></div>`;
const OUTER = `<!doctype html><meta charset="utf-8"><h1>сайт вокруг</h1>
<iframe src="http://localhost:${PORT}/inner.html" width="900" height="540" allow="autoplay; fullscreen"></iframe>`;

/** По слушателю на каждый origin: для браузера localhost и 127.0.0.1 — разные сайты. */
function serve(host, body) {
  const srv = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(body));
  return new Promise((resolve) => srv.listen(PORT, host, () => resolve(srv)));
}

const servers = await Promise.all([serve("localhost", INNER), serve("127.0.0.1", OUTER)]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--no-sandbox"] });
let bad = 0;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  const frame = page.frames().find((f) => f.url().includes("inner.html"));
  if (!frame) throw new Error("во фрейме не открылась страница плеера");

  await frame.addStyleTag({ path: `${EXT}content.css` });
  await frame.addScriptTag({ path: `${EXT}content.js` });

  // Реплика в окне субтитров, как её нарисовал бы плеер.
  await frame.evaluate(() => {
    const line = document.getElementById("cc-line");
    line.innerHTML = "";
    line.append(Object.assign(document.createElement("span"), { className: "ytp-caption-segment", textContent: "Nice to meet you" }));
  });
  await new Promise((r) => setTimeout(r, 400));

  // Браузер правда запрещает здесь clipboard-write — убеждаемся, что проверка не на пустом месте.
  const denied = await frame.evaluate(async () => {
    try {
      await navigator.clipboard.writeText("probe");
      return false;
    } catch {
      return true;
    }
  });
  console.log(`${denied ? "ok  " : "??  "} во фрейме clipboard-write запрещён браузером${denied ? "" : " (не запрещён — проверка всё равно валидна)"}`);

  // Что панель отдаёт в запасной путь: подменяем execCommand и снимаем textarea.
  await frame.evaluate(() => {
    window.__copied = null;
    document.execCommand = (cmd) => {
      if (cmd !== "copy") return false;
      window.__copied = document.querySelector("textarea[readonly]")?.value ?? "(нет textarea)";
      return true;
    };
  });

  // Выделяем два слова: копировать должно выделенное, а не всю реплику.
  const clickWord = (n) =>
    frame.evaluate((i) => document.querySelectorAll("#wordboss-panel .wb-word")[i]?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })), n);
  await clickWord(2);
  await new Promise((r) => setTimeout(r, 80));
  await clickWord(3);
  await new Promise((r) => setTimeout(r, 80));

  await frame.evaluate(() => document.querySelector("#wordboss-panel .wb-copy").click());
  await new Promise((r) => setTimeout(r, 400));

  const got = await frame.evaluate(() => ({
    text: window.__copied,
    toast: document.querySelector("#wordboss-panel .wb-toast").className,
  }));

  const check = (name, ok, detail) => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  };
  check("копирование не падает с ошибкой", got.toast.includes("wb-ok"), `плашка: ${got.toast}`);
  check("скопировано выделенное", got.text === "meet you", `ушло: ${JSON.stringify(got.text)}`);
} finally {
  await browser.close();
  for (const s of servers) s?.close();
}
process.exit(bad ? 1 : 0);
