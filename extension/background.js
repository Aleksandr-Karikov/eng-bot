// Сетевые запросы к боту — отсюда, а не из страницы: у расширения есть доступ к localhost без CORS и смешанного контента.
const DEFAULT_SERVER = "http://localhost:8787";

/** Ключ и адрес, вписанные ботом в архив (preset.json); в папке из репозитория его нет. */
async function preset() {
  try {
    return await (await fetch(chrome.runtime.getURL("preset.json"))).json();
  } catch {
    return {};
  }
}

// Настройки храним на устройстве (local), а не в sync: иначе адрес localhost с одного компьютера
// приезжает на другой через аккаунт Google, и там бот «не отвечает».
// Порядок: сохранённое на этом устройстве → вписанное в архив → старое из sync.
async function settings() {
  const [local, built, synced] = await Promise.all([chrome.storage.local.get(["key", "server"]), preset(), chrome.storage.sync.get(["key", "server"])]);
  const key = local.key || built.key || synced.key || "";
  const server = local.server || built.server || synced.server || DEFAULT_SERVER;
  return { key: key.trim(), server: server.trim().replace(/\/+$/, "") };
}

async function call(path, init) {
  const { server } = await settings();
  try {
    // Без этого заголовка ngrok вместо ответа отдаёт свою страницу-предупреждение.
    const res = await fetch(`${server}${path}`, { ...init, headers: { ...init?.headers, "ngrok-skip-browser-warning": "1" } });
    const body = await res.json().catch(() => ({}));
    return res.ok ? body : { ok: false, error: body.error || `Бот ответил ${res.status}` };
  } catch {
    return { ok: false, error: `Не достучался до ${server} — проверь адрес в настройках расширения (его даёт /extension в боте)` };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    const { key } = await settings();
    if (message.type === "openOptions") return chrome.runtime.openOptionsPage();
    if (message.type === "settings") return reply(await settings());
    // Снимок вкладки для рамки: доступ к ней дал клик по иконке, Alt+Shift+S или пункт меню (activeTab).
    if (message.type === "screenshot") {
      try {
        return reply({ ok: true, dataUrl: await chrome.tabs.captureVisibleTab(_sender.tab.windowId, { format: "png" }) });
      } catch (err) {
        return reply({ ok: false, error: `Не получилось снять экран: ${err.message}` });
      }
    }
    if (!key) return reply({ ok: false, error: "Вставь ключ в настройках расширения (/extension в боте)", needsKey: true });
    if (message.type === "ping") return reply(await call(`/ping?key=${encodeURIComponent(key)}`));
    if (message.type === "words") return reply(await call(`/words?key=${encodeURIComponent(key)}`));
    if (message.type === "example") {
      return reply(
        await call("/example", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...message.payload, key }),
        }),
      );
    }
    if (message.type === "readImage") {
      return reply(
        await call("/read-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...message.payload, key }),
        }),
      );
    }
    if (message.type === "capture") {
      return reply(
        await call("/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...message.payload, key }),
        }),
      );
    }
  })();
  return true; // ответ асинхронный
});

// ---------- На любом сайте ----------
// Рамка подключается к вкладке по действию человека (activeTab), постоянного «читать все сайты» нет.
// Панель субтитров — так же разово; а для плеера во вложенном фрейме доступ ко всем сайтам берётся
// по жесту и только на время включённого «режима фильма» (enableMovieMode / disableMovieMode ниже).

async function injectPanel(target) {
  await chrome.scripting.insertCSS({ target, files: ["content.css"] });
  await chrome.scripting.executeScript({ target, files: ["content.js"] });
}

async function startRegion(tab) {
  try {
    await injectPanel({ tabId: tab.id });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["region.js"] });
  } catch (err) {
    // chrome://, магазин расширений и подобные страницы расширениям закрыты.
    console.warn("WordBoss: can't start on this page", err);
  }
}

// «Режим фильма»: панель субтитров на любом сайте. content.js сам найдёт видео (`findVideo`) и реплики
// (дорожки WebVTT или текст поверх видео) — как на inoriginal.cc. Главная трудность: видео обычно сидит
// во вложенном cross-origin iframe плеера (домен заранее неизвестен), который догружается ПОСЛЕ клика и
// бывает двойным. Разовая инъекция в него не попадает. Поэтому режим включается по жесту человека: просим
// доступ ко всем сайтам и регистрируем панель постоянным content-script'ом — браузер сам вставляет её в
// каждый фрейм при загрузке, включая поздние и вложенные (как объявленный скрипт inoriginal.cc, но везде).
const ALL_URLS = { origins: ["<all_urls>"] };
const PANEL_SCRIPT = {
  id: "wordboss-panel",
  matches: ["<all_urls>"],
  allFrames: true,
  matchOriginAsFallback: true, // about:blank/blob-фреймы некоторых плееров
  js: ["content.js"],
  css: ["content.css"],
  runAt: "document_idle",
};

async function movieModeOn() {
  const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [PANEL_SCRIPT.id] }).catch(() => []);
  return reg.length > 0;
}

/** Подключить панель к текущей вкладке сразу (уже загруженные фреймы постоянный скрипт не покрывает). */
async function startPanel(tab) {
  const broad = await chrome.permissions.contains(ALL_URLS).catch(() => false);
  const hint = broad
    ? "🎬 WordBoss включён. Субтитры появятся, когда пойдёт видео. Если их не видно текстом — выдели область: Alt+Shift+S"
    : "🎬 Плеер во встроенном окне? Включи через правый клик → «🎬 Субтитры WordBoss…» и разреши доступ. Вшитые в кадр субтитры — Alt+Shift+S";
  try {
    await injectPanel({ tabId: tab.id, allFrames: broad });
    // Статус — только в верхнем фрейме: видео и субтитры появляются не сразу, сразу даём знать, что включилось.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (m) => window.__wordbossAPI?.status(m), args: [hint] });
  } catch (err) {
    // chrome://, магазин расширений и подобные страницы расширениям закрыты.
    console.warn("WordBoss: can't start on this page", err);
  }
}

// Включить режим фильма: доступ ко всем сайтам (по жесту) + регистрация панели на будущих загрузках фреймов.
async function enableMovieMode(tab) {
  const granted = await chrome.permissions.request(ALL_URLS).catch(() => false);
  // Доступ не дали (отказ или жест не засчитан) — работаем хотя бы в доступных фреймах текущей вкладки.
  if (!granted) return void startPanel(tab);
  if (!(await movieModeOn())) await chrome.scripting.registerContentScripts([PANEL_SCRIPT]).catch((err) => console.warn("WordBoss: register failed", err));
  await startPanel(tab);
}

// Выключить режим фильма: снять регистрацию и вернуть доступ. Панель перестанет подключаться сама.
async function disableMovieMode() {
  if (await movieModeOn()) await chrome.scripting.unregisterContentScripts({ ids: [PANEL_SCRIPT.id] }).catch(() => {});
  await chrome.permissions.remove(ALL_URLS).catch(() => {});
}

// Клик по иконке или Alt+Shift+S — рамка; Alt+Shift+V — панель субтитров. Настройки — правый клик по иконке → «Параметры» или ⚙ в панели.
chrome.action.onClicked.addListener((tab) => void startRegion(tab));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "region" && tab) void startRegion(tab);
  else if (command === "panel" && tab) void enableMovieMode(tab);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "wordboss-add", title: "➕ В WordBoss: «%s»", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "wordboss-panel", title: "🎬 Субтитры WordBoss на этой странице", contexts: ["page", "action"] });
  chrome.contextMenus.create({ id: "wordboss-panel-off", title: "⏹ Выключить режим фильма WordBoss", contexts: ["action"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "wordboss-panel-off") return void disableMovieMode();
  if (!tab?.id) return;
  if (info.menuItemId === "wordboss-panel") return void enableMovieMode(tab);
  if (info.menuItemId !== "wordboss-add") return;
  // Выделение может быть во фрейме (плеер, встроенная статья) — панель там же.
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
  try {
    await injectPanel(target);
    await chrome.scripting.executeScript({ target, func: () => window.__wordbossAPI?.addSelection() });
  } catch (err) {
    console.warn("WordBoss: can't add from this page", err);
  }
});
