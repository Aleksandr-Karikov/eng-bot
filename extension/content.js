// WordBoss: панель с текущей репликой субтитров — клик по слову или протяжка по фразе отправляет её в бота.
(() => {
  if (window.__wordbossLoaded) return;
  window.__wordbossLoaded = true;

  const HISTORY = 30;
  /** Реплика длиннее — скорее всего, не субтитр, а кусок страницы. */
  const MAX_LINE = 300;

  const state = {
    video: null,
    lines: [], // последние реплики, новые в конце
    index: -1, // какую показываем
    selection: null, // [start, end] индексы слов
    anchor: null,
    pausedByUs: false,
    sending: false,
    /** Мышь над панелью: реплика «замерзает», можно выделять и листать. Иначе всегда показываем текущую. */
    hover: false,
    /** Что уже добавлено за этот сеанс (в нижнем регистре) — подсвечиваем в репликах. */
    added: new Set(),
    /** Слова, которые человек уже учит (из бота): { id, term, translation, parts } — подсвечиваются в субтитрах. */
    known: [],
    /** Открытая подсказка по знакомому слову. */
    popup: null,
  };

  // ---------- Знакомые слова ----------

  /** Грубая основа слова, чтобы «wiped» нашлось по «wipe out», а «running» — по «run late». */
  function stem(word) {
    let w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
    if (w.length > 3) {
      w = w.replace(/ies$/, "y").replace(/ied$/, "y").replace(/(ing|ed|es)$/, "").replace(/s$/, "");
      w = w.replace(/([b-df-hj-np-tv-z])\1$/, "$1").replace(/e$/, "");
    }
    return w;
  }

  const WILDCARDS = new Set(["someone", "somebody", "something", "one's", "someone's", "smb", "sth"]);

  function setKnown(words) {
    state.known = words.map((w) => ({
      ...w,
      parts: w.term.toLowerCase().replace(/^to\s+/, "").split(/\s+/).filter(Boolean).map((p) => (WILDCARDS.has(p) ? "*" : stem(p))),
    }));
    render();
  }

  async function loadKnown() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "words" });
      if (res?.ok) setKnown(res.words);
    } catch {
      // расширение перезагрузили — подсветка появится после обновления страницы
    }
  }

  /** Индекс слова реплики → знакомое слово, которое на нём стоит. Фразы — подряд идущими словами. */
  function knownTokens(list) {
    const marks = new Map();
    const words = list.map((t, i) => ({ i, s: t.word ? stem(t.text) : null })).filter((x) => x.s);
    for (const entry of state.known) {
      const parts = entry.parts;
      if (!parts.length) continue;
      for (let k = 0; k + parts.length <= words.length; k++) {
        if (parts.every((p, j) => p === "*" || words[k + j].s === p)) for (let j = 0; j < parts.length; j++) marks.set(words[k + j].i, entry);
      }
    }
    return marks;
  }

  /** Включить подробный лог: в консоли страницы localStorage.wordbossDebug = 1 и обновить страницу. */
  const debug = (...args) => {
    try {
      if (localStorage.getItem("wordbossDebug")) console.log("[WordBoss]", ...args);
    } catch {
      // localStorage может быть недоступен — без лога
    }
  };

  // ---------- Откуда берём реплики ----------

  const cleanCue = (text) =>
    text
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "") // теги ASS вроде {\an8}
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Субтитр — это английские слова, а не таймер «12:34» или подпись кнопки плеера. */
  const looksLikeSpeech = (line) => /[A-Za-z]{2,}/.test(line) && !/^[\d:.\s/]+$/.test(line);

  function pushLine(raw, source) {
    const line = cleanCue(raw || "");
    if (!line || line.length > MAX_LINE || !looksLikeSpeech(line)) return;
    if (state.lines.at(-1) === line) return;
    debug(source, line);
    state.lines.push(line);
    if (state.lines.length > HISTORY) {
      state.lines.shift();
      state.index -= 1;
    }
    // Пока мышь над панелью, новая реплика не выбивает старую из-под курсора.
    if (!state.hover || state.index < 0) {
      state.index = state.lines.length - 1;
      state.selection = null;
    }
    render();
  }

  /** Способ 1: стандартные дорожки субтитров (WebVTT) — так их отдаёт hls.js в Playerjs. */
  function watchTracks(video) {
    const hook = (track) => {
      if (track.__wordboss || !["subtitles", "captions"].includes(track.kind)) return;
      track.__wordboss = true;
      // Выключенная дорожка не присылает реплики; «hidden» — присылает, но не рисует поверх видео.
      if (track.mode === "disabled" && looksEnglish(track)) track.mode = "hidden";
      track.addEventListener("cuechange", () => readTrack(track, "cuechange"));
    };
    Array.from(video.textTracks).forEach(hook);
    video.textTracks.addEventListener("addtrack", (e) => hook(e.track));
  }

  function readTrack(track, source) {
    if (track.mode === "disabled") return;
    const cues = Array.from(track.activeCues || []);
    if (cues.length) pushLine(cues.map((c) => c.text).join(" "), `${source}:${track.label || track.language}`);
  }

  /** События cuechange плеер может глушить (переключая дорожки) — подстраховываемся опросом. */
  setInterval(() => {
    if (!state.video) return;
    for (const track of Array.from(state.video.textTracks)) if (["subtitles", "captions"].includes(track.kind)) readTrack(track, "poll");
  }, 250);

  const looksEnglish = (track) => /^en/i.test(track.language || "") || /eng|англ/i.test(track.label || "");

  /** Способ 2: плеер рисует субтитры сам — берём короткий текст, который меняется поверх нижней части видео. */
  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      const video = state.video;
      if (!video) return;
      const rect = video.getBoundingClientRect();
      for (const m of mutations) {
        const node = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
        if (!node || node.closest?.("#wordboss-panel")) continue;
        const text = node.innerText || "";
        if (!text.trim() || text.length > MAX_LINE) continue;
        const r = node.getBoundingClientRect();
        const overVideo = r.width > 0 && r.top >= rect.top + rect.height * 0.4 && r.bottom <= rect.bottom + 40 && r.left >= rect.left - 20 && r.right <= rect.right + 20;
        if (overVideo) pushLine(text, "dom");
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function findVideo() {
    const videos = Array.from(document.querySelectorAll("video")).filter((v) => v.getBoundingClientRect().width > 200);
    const video = videos.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!video || video === state.video) return;
    state.video = video;
    debug("video", video.currentSrc, "tracks:", Array.from(video.textTracks).map((t) => `${t.kind}/${t.label}/${t.language}/${t.mode}`));
    watchTracks(video);
    position();
  }

  // ---------- Панель ----------

  const panel = document.createElement("div");
  panel.id = "wordboss-panel";
  panel.innerHTML = `
    <div class="wb-line"></div>
    <div class="wb-bar">
      <button class="wb-prev" title="Предыдущая реплика">◀</button>
      <button class="wb-next" title="Следующая реплика">▶</button>
      <span class="wb-status">Клик — слово, клик по другому — фраза. ➕ без выделения — вся реплика</span>
      <span class="wb-count" title="Добавлено за этот сеанс"></span>
      <button class="wb-add" title="Добавить в бота (Enter)">➕ В бота</button>
      <button class="wb-settings" title="Настройки">⚙</button>
    </div>
    <div class="wb-toast"></div>
    <div class="wb-pop wb-hidden"><span class="wb-pop-text"></span><button class="wb-pop-example">📍 Ещё пример</button><button class="wb-pop-close">✕</button></div>`;
  const lineEl = panel.querySelector(".wb-line");
  const statusEl = panel.querySelector(".wb-status");
  const addButton = panel.querySelector(".wb-add");
  const toastEl = panel.querySelector(".wb-toast");
  const countEl = panel.querySelector(".wb-count");
  const popEl = panel.querySelector(".wb-pop");

  function showPopup(entry) {
    state.popup = entry;
    popEl.querySelector(".wb-pop-text").innerHTML = "";
    const b = document.createElement("b");
    b.textContent = entry.term;
    popEl.querySelector(".wb-pop-text").append(b, ` — ${entry.translation}`);
    popEl.classList.remove("wb-hidden");
  }

  function hidePopup() {
    state.popup = null;
    popEl.classList.add("wb-hidden");
  }

  /** «📍 Ещё пример»: эта реплика сохранится у слова — на карточке будет видно, где оно встретилось снова. */
  async function sendExample() {
    const entry = state.popup;
    const line = state.lines[state.index];
    if (!entry || !line) return;
    hidePopup();
    try {
      const res = await chrome.runtime.sendMessage({ type: "example", payload: { wordId: entry.id, context: line, title: pageTitle() } });
      if (res?.ok && res.added.length) toast(`📍 Сохранил пример для «${entry.term}»`, "wb-ok");
      else if (res?.ok) toast(`Эта реплика у «${entry.term}» уже есть`, "wb-ok");
      else toast(`✗ ${res?.error ?? "Расширение не ответило — обнови страницу"}`, "wb-err");
    } catch {
      toast("✗ Расширение обновилось — перезагрузи страницу", "wb-err");
    }
  }
  let toastTimer;

  /** Плашка над панелью: видна, даже если реплика уже сменилась. */
  function toast(text, kind) {
    toastEl.textContent = text;
    toastEl.className = `wb-toast wb-show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = "wb-toast"), kind === "wb-err" ? 6000 : 4000);
  }

  function tokens(line) {
    // Слова и всё между ними — чтобы выделенная фраза собиралась ровно как в реплике.
    return Array.from(line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[^\p{L}\p{N}]+/gu)).map((m) => ({ text: m[0], start: m.index, word: /[\p{L}\p{N}]/u.test(m[0][0]) }));
  }

  /** Индексы слов реплики, входящих в уже добавленные слова и фразы. */
  function addedTokens(list) {
    const marked = new Set();
    const words = list.map((t, i) => ({ i, w: t.word ? t.text.toLowerCase().replace(/’/g, "'") : null })).filter((x) => x.w);
    for (const term of state.added) {
      const parts = term.split(/\s+/);
      for (let k = 0; k + parts.length <= words.length; k++) {
        if (parts.every((p, j) => words[k + j].w === p)) for (let j = 0; j < parts.length; j++) marked.add(words[k + j].i);
      }
    }
    return marked;
  }

  function render() {
    const line = state.lines[state.index];
    panel.classList.toggle("wb-hidden", !line);
    countEl.textContent = state.added.size ? `➕ ${state.added.size}` : "";
    if (!line) return;
    lineEl.textContent = "";
    const list = tokens(line);
    const marked = addedTokens(list);
    const known = knownTokens(list);
    list.forEach((t, i) => {
      const span = document.createElement("span");
      span.textContent = t.text;
      if (t.word) {
        span.className = "wb-word";
        span.dataset.i = String(i);
        const [a, b] = state.selection ?? [-1, -1];
        if (i >= a && i <= b) span.classList.add("wb-selected");
        else if (marked.has(i)) span.classList.add("wb-added");
        else if (known.has(i)) {
          span.classList.add("wb-known");
          span.dataset.known = String(known.get(i).id);
        }
      }
      lineEl.appendChild(span);
    });
    panel.querySelector(".wb-prev").disabled = state.index <= 0;
    panel.querySelector(".wb-next").disabled = state.index >= state.lines.length - 1;
  }

  function selectedText() {
    const line = state.lines[state.index];
    if (!line || !state.selection) return "";
    const list = tokens(line);
    const [a, b] = state.selection;
    return line.slice(list[a].start, list[b].start + list[b].text.length);
  }

  function setStatus(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `wb-status ${kind}`;
  }

  async function send() {
    const line = state.lines[state.index];
    if (!line || state.sending) return;
    state.sending = true;
    const text = selectedText();
    setStatus(text ? `Добавляю «${text}»…` : "Ищу, что выучить в реплике…");
    addButton.textContent = "⏳ Добавляю…";
    addButton.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "capture",
        payload: { text, context: line, title: pageTitle() },
      });
      if (res?.ok) {
        void loadKnown();
        for (const term of [...res.added.map((a) => a.term), ...res.duplicates]) state.added.add(term.toLowerCase().replace(/’/g, "'"));
        state.selection = null;
        render();
      }
      if (res?.ok && res.added.length) {
        const what = res.added.map((a) => `${a.term} — ${a.translation}`).join("; ");
        toast(`✓ Добавлено: ${what}`, "wb-ok");
        setStatus(`✓ ${what}`, "wb-ok");
      } else if (res?.ok) {
        toast(`Уже есть в комнате: ${res.duplicates.join(", ")}`, "wb-ok");
        setStatus(`Уже есть: ${res.duplicates.join(", ")}`, "wb-ok");
      } else {
        toast(`✗ ${res?.error ?? "Расширение не ответило — обнови страницу"}`, "wb-err");
        setStatus("✗ Не добавлено", "wb-err");
      }
    } catch {
      toast("✗ Расширение обновилось — перезагрузи страницу", "wb-err");
    } finally {
      state.sending = false;
      addButton.textContent = "➕ В бота";
      addButton.disabled = false;
    }
  }

  const pageTitle = () =>
    (document.querySelector("h1")?.textContent || document.title).replace(/\s*(смотреть|онлайн|—\s*inoriginal).*$/i, "").trim().slice(0, 200);

  // Выделение. Клик — слово; клик по другому слову — фраза от выделенного до него; клик внутри выделения — снять.
  // Протяжка тоже работает: смотрим, зажата ли кнопка (e.buttons), а не ждём mouseup — его глушит плеер.
  const wordAt = (x, y) => document.elementFromPoint(x, y)?.closest?.("#wordboss-panel .wb-word");

  lineEl.addEventListener("pointerdown", (e) => {
    const span = e.target.closest(".wb-word");
    if (!span || e.button !== 0) return;
    e.preventDefault();
    const i = Number(span.dataset.i);
    const sel = state.selection;
    // Знакомое слово без начатого выделения — подсказка с переводом, а не новое слово.
    if (!sel && span.dataset.known) {
      const entry = state.known.find((k) => String(k.id) === span.dataset.known);
      if (entry) return showPopup(entry);
    }
    hidePopup();
    if (sel && i >= sel[0] && i <= sel[1]) {
      state.selection = null;
      state.anchor = null;
    } else if (sel) {
      state.selection = [Math.min(sel[0], i), Math.max(sel[1], i)];
      state.anchor = sel[0] <= i ? sel[0] : sel[1];
    } else {
      state.selection = [i, i];
      state.anchor = i;
    }
    render();
  });

  lineEl.addEventListener("pointermove", (e) => {
    if (!(e.buttons & 1) || state.anchor === null) return;
    const span = wordAt(e.clientX, e.clientY);
    if (!span) return;
    const i = Number(span.dataset.i);
    const next = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    if (state.selection && next[0] === state.selection[0] && next[1] === state.selection[1]) return;
    state.selection = next;
    render();
  });

  // Пока мышь над панелью — пауза, чтобы реплика не убежала.
  panel.addEventListener("mouseenter", () => {
    state.hover = true;
    if (state.video && !state.video.paused) {
      state.video.pause();
      state.pausedByUs = true;
    }
  });
  panel.addEventListener("mouseleave", () => {
    state.hover = false;
    hidePopup();
    if (state.pausedByUs && state.video) state.video.play().catch(() => {});
    state.pausedByUs = false;
    // Вернуться к текущей реплике.
    if (state.index !== state.lines.length - 1 || state.selection) {
      state.index = state.lines.length - 1;
      state.selection = null;
      render();
    }
  });

  panel.querySelector(".wb-add").addEventListener("click", send);
  panel.querySelector(".wb-pop-example").addEventListener("click", sendExample);
  panel.querySelector(".wb-pop-close").addEventListener("click", hidePopup);
  panel.querySelector(".wb-settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
  panel.querySelector(".wb-prev").addEventListener("click", () => {
    state.index = Math.max(0, state.index - 1);
    state.selection = null;
    render();
  });
  panel.querySelector(".wb-next").addEventListener("click", () => {
    state.index = Math.min(state.lines.length - 1, state.index + 1);
    state.selection = null;
    render();
  });
  // Клики по панели не должны доходить до плеера (там клик — пауза/плей).
  for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "pointermove"]) {
    panel.addEventListener(type, (e) => e.stopPropagation());
  }

  // Enter — отправить выделенное; Alt+S — отправить всю реплику; Esc — снять выделение.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target.closest?.("input, textarea, [contenteditable]")) return;
      if (e.key === "Enter" && state.selection) {
        e.preventDefault();
        e.stopPropagation();
        send();
      } else if (e.code === "KeyS" && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        state.selection = null;
        send();
      } else if (e.key === "Escape" && state.selection) {
        state.selection = null;
        render();
      }
    },
    true,
  );

  /** Панель — над нижней частью видео; в полноэкранном режиме — внутри полноэкранного элемента, иначе её не видно. */
  function position() {
    const host = document.fullscreenElement || document.body;
    if (panel.parentElement !== host) host.appendChild(panel);
    const video = state.video;
    if (!video) return;
    const r = video.getBoundingClientRect();
    panel.style.left = `${Math.max(8, r.left + r.width * 0.1)}px`;
    panel.style.width = `${Math.max(280, r.width * 0.8)}px`;
    panel.style.top = `${Math.max(8, r.top + 12)}px`;
  }

  document.addEventListener("fullscreenchange", position);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, { passive: true });
  setInterval(() => {
    findVideo();
    position();
  }, 1000);

  watchDom();
  findVideo();
  render();
  void loadKnown();
  // Друзья добавляют слова — обновляем список раз в несколько минут.
  setInterval(loadKnown, 3 * 60_000);
})();
