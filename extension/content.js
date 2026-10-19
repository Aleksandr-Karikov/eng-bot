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
    dragging: false,
    pausedByUs: false,
    sending: false,
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

  function pushLine(raw) {
    const line = cleanCue(raw || "");
    if (!line || line.length > MAX_LINE || !looksLikeSpeech(line)) return;
    if (state.lines.at(-1) === line) return;
    // Пока человек выделяет слова в прошлой реплике, новая не должна выбивать её из-под мыши.
    const following = state.index === state.lines.length - 1 && !state.selection;
    state.lines.push(line);
    if (state.lines.length > HISTORY) {
      state.lines.shift();
      state.index -= 1;
    }
    state.index = following || state.index < 0 ? state.lines.length - 1 : state.index;
    render();
  }

  /** Способ 1: стандартные дорожки субтитров (WebVTT) — так их отдаёт hls.js в Playerjs. */
  function watchTracks(video) {
    const hook = (track) => {
      if (track.__wordboss || !["subtitles", "captions"].includes(track.kind)) return;
      track.__wordboss = true;
      // Выключенная дорожка не присылает реплики; «hidden» — присылает, но не рисует поверх видео.
      if (track.mode === "disabled" && looksEnglish(track)) track.mode = "hidden";
      track.addEventListener("cuechange", () => {
        if (track.mode === "disabled") return;
        const cues = Array.from(track.activeCues || []);
        if (cues.length) pushLine(cues.map((c) => c.text).join(" "));
      });
    };
    Array.from(video.textTracks).forEach(hook);
    video.textTracks.addEventListener("addtrack", (e) => hook(e.track));
  }

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
        if (overVideo) pushLine(text);
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function findVideo() {
    const videos = Array.from(document.querySelectorAll("video")).filter((v) => v.getBoundingClientRect().width > 200);
    const video = videos.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!video || video === state.video) return;
    state.video = video;
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
      <span class="wb-status">Выдели слово или фразу — или ➕ для всей реплики</span>
      <button class="wb-add" title="Добавить в бота (Enter)">➕ В бота</button>
      <button class="wb-settings" title="Настройки">⚙</button>
    </div>`;
  const lineEl = panel.querySelector(".wb-line");
  const statusEl = panel.querySelector(".wb-status");

  function tokens(line) {
    // Слова и всё между ними — чтобы выделенная фраза собиралась ровно как в реплике.
    return Array.from(line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[^\p{L}\p{N}]+/gu)).map((m) => ({ text: m[0], start: m.index, word: /[\p{L}\p{N}]/u.test(m[0][0]) }));
  }

  function render() {
    const line = state.lines[state.index];
    panel.classList.toggle("wb-hidden", !line);
    if (!line) return;
    lineEl.textContent = "";
    tokens(line).forEach((t, i) => {
      const span = document.createElement("span");
      span.textContent = t.text;
      if (t.word) {
        span.className = "wb-word";
        span.dataset.i = String(i);
        const [a, b] = state.selection ?? [-1, -1];
        if (i >= a && i <= b) span.classList.add("wb-selected");
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
    try {
      const res = await chrome.runtime.sendMessage({
        type: "capture",
        payload: { text, context: line, title: pageTitle() },
      });
      if (res?.ok && res.added.length) setStatus(`✓ ${res.added.map((a) => `${a.term} — ${a.translation}`).join("; ")}`, "wb-ok");
      else if (res?.ok) setStatus(`Уже есть в комнате: ${res.duplicates.join(", ")}`, "wb-ok");
      else setStatus(`✗ ${res?.error ?? "Расширение не ответило — обнови страницу"}`, "wb-err");
      if (res?.ok) {
        state.selection = null;
        render();
      }
    } catch {
      setStatus("✗ Расширение обновилось — перезагрузи страницу", "wb-err");
    } finally {
      state.sending = false;
    }
  }

  const pageTitle = () =>
    (document.querySelector("h1")?.textContent || document.title).replace(/\s*(смотреть|онлайн|—\s*inoriginal).*$/i, "").trim().slice(0, 200);

  // Выделение: нажал на слово и протянул — фраза; клик по выделенному одиночному слову — снять.
  lineEl.addEventListener("mousedown", (e) => {
    const span = e.target.closest(".wb-word");
    if (!span) return;
    e.preventDefault();
    const i = Number(span.dataset.i);
    if (e.shiftKey && state.anchor !== null) {
      state.selection = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    } else if (state.selection && state.selection[0] === i && state.selection[1] === i) {
      state.selection = null;
      state.anchor = null;
    } else {
      state.anchor = i;
      state.selection = [i, i];
      state.dragging = true;
    }
    render();
  });
  lineEl.addEventListener("mouseover", (e) => {
    const span = e.target.closest(".wb-word");
    if (!state.dragging || !span || state.anchor === null) return;
    const i = Number(span.dataset.i);
    state.selection = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    render();
  });
  document.addEventListener("mouseup", () => (state.dragging = false));

  // Пока мышь над панелью — пауза, чтобы реплика не убежала.
  panel.addEventListener("mouseenter", () => {
    if (state.video && !state.video.paused) {
      state.video.pause();
      state.pausedByUs = true;
    }
  });
  panel.addEventListener("mouseleave", () => {
    if (state.pausedByUs && state.video) state.video.play().catch(() => {});
    state.pausedByUs = false;
  });

  panel.querySelector(".wb-add").addEventListener("click", send);
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
  for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup"]) {
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
})();
