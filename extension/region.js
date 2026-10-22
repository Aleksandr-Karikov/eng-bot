// WordBoss: рамка на любой странице. Текст, который в неё попал, — в панель; если текста на странице нет
// (кадр видео, картинка, скан) — снимок области распознаёт бот. Запускается иконкой расширения или Alt+Shift+S.
(() => {
  if (document.getElementById("wordboss-region")) return;
  const api = window.__wordbossAPI;
  if (!api) return;

  const overlay = document.createElement("div");
  overlay.id = "wordboss-region";
  overlay.innerHTML = `<div class="wb-region-hint">Выдели область с английским текстом · Esc — отмена</div><div class="wb-region-box"></div>`;
  const box = overlay.querySelector(".wb-region-box");
  (document.fullscreenElement || document.body).appendChild(overlay);

  let start = null;
  const rectOf = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  document.addEventListener("keydown", onKey, true);

  overlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!start) return;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  });
  overlay.addEventListener("pointerup", (e) => {
    if (!start) return;
    const r = rectOf(start, { x: e.clientX, y: e.clientY });
    start = null;
    close();
    if (r.right - r.left < 8 || r.bottom - r.top < 8) return;
    void take(r);
  });

  /** Сначала — настоящий текст страницы в рамке: мгновенно и без ошибок распознавания. */
  async function take(r) {
    const text = textInRect(r);
    if (/[A-Za-z]{2,}/.test(text)) return api.showText(text);
    api.status("⏳ Текста на странице нет — распознаю картинку…");
    try {
      const image = await snapshot(r);
      const res = await chrome.runtime.sendMessage({ type: "readImage", payload: { image } });
      if (!res?.ok) return api.fail(res?.error ?? "Расширение не ответило — обнови страницу");
      if (!/[A-Za-z]{2,}/.test(res.text)) return api.fail("Не нашёл тут английского текста 🤔");
      api.showText(res.text);
    } catch (err) {
      // Расширение перезагрузили, а страницу — нет: связь со старым расширением порвалась.
      const stale = !err?.message || /context invalidated/i.test(err.message);
      api.fail(stale ? "Расширение обновилось — перезагрузи страницу" : err.message);
    }
  }

  /** Слова текстовых узлов, чей центр внутри рамки; из каждого узла — кусок от первого такого слова до последнего. */
  function textInRect(r) {
    const inside = (b) => {
      const x = (b.left + b.right) / 2;
      const y = (b.top + b.bottom) / 2;
      return b.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const touches = (b) => b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || !node.data.trim() || el.closest("#wordboss-panel, #wordboss-region, script, style, noscript")) return NodeFilter.FILTER_REJECT;
        return touches(el.getBoundingClientRect()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const pieces = [];
    const range = document.createRange();
    let words = 0;
    for (let node = walker.nextNode(); node && words < 600; node = walker.nextNode()) {
      let first = -1;
      let last = -1;
      let top = 0;
      for (const m of node.data.matchAll(/\S+/g)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const b = range.getBoundingClientRect();
        if (!inside(b)) continue;
        if (first < 0) {
          first = m.index;
          top = b.top;
        }
        last = m.index + m[0].length;
        words++;
      }
      if (first >= 0) pieces.push({ text: node.data.slice(first, last), top });
    }
    // Новая строка — когда кусок заметно ниже предыдущего; иначе это та же строка, разбитая тегами.
    let out = "";
    let prevTop = null;
    for (const p of pieces) {
      if (prevTop !== null) out += p.top - prevTop > 12 ? "\n" : /[\s(«"']$/.test(out) || /^[.,!?;:)»"']/.test(p.text) ? "" : " ";
      out += p.text;
      prevTop = p.top;
    }
    return out.replace(/[ \t]+/g, " ").trim();
  }

  /** Снимок видимой части вкладки (рамку уже убрали) → вырезаем область, уменьшаем, JPEG. */
  async function snapshot(r) {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const shot = await chrome.runtime.sendMessage({ type: "screenshot" });
    if (!shot?.ok) throw new Error(shot?.error ?? "Не получилось снять экран");
    const img = new Image();
    img.src = shot.dataUrl;
    await img.decode();
    const scale = img.width / window.innerWidth;
    const sw = (r.right - r.left) * scale;
    const sh = (r.bottom - r.top) * scale;
    const fit = Math.min(1, 1600 / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * fit);
    canvas.height = Math.round(sh * fit);
    canvas.getContext("2d").drawImage(img, r.left * scale, r.top * scale, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  }
})();
