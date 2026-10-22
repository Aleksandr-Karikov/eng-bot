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
// Панель и рамка подключаются к вкладке только по действию человека — разрешения «читать все сайты» нет.

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

// Клик по иконке или Alt+Shift+S — рамка. Настройки — правый клик по иконке → «Параметры» или ⚙ в панели.
chrome.action.onClicked.addListener((tab) => void startRegion(tab));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "region" && tab) void startRegion(tab);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "wordboss-add", title: "➕ В WordBoss: «%s»", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "wordboss-add" || !tab?.id) return;
  // Выделение может быть во фрейме (плеер, встроенная статья) — панель там же.
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
  try {
    await injectPanel(target);
    await chrome.scripting.executeScript({ target, func: () => window.__wordbossAPI?.addSelection() });
  } catch (err) {
    console.warn("WordBoss: can't add from this page", err);
  }
});
