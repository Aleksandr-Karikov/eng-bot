// Сетевые запросы к боту — отсюда, а не из страницы: у расширения есть доступ к localhost без CORS и смешанного контента.
const DEFAULT_SERVER = "http://localhost:8787";

async function settings() {
  const { key = "", server = DEFAULT_SERVER } = await chrome.storage.sync.get(["key", "server"]);
  return { key: key.trim(), server: (server || DEFAULT_SERVER).replace(/\/+$/, "") };
}

async function call(path, init) {
  const { server } = await settings();
  try {
    const res = await fetch(`${server}${path}`, init);
    const body = await res.json().catch(() => ({}));
    return res.ok ? body : { ok: false, error: body.error || `Бот ответил ${res.status}` };
  } catch {
    return { ok: false, error: "Бот не отвечает — он запущен на этом компьютере?" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  (async () => {
    const { key } = await settings();
    if (message.type === "openOptions") return chrome.runtime.openOptionsPage();
    if (!key) return reply({ ok: false, error: "Вставь ключ в настройках расширения (/extension в боте)", needsKey: true });
    if (message.type === "ping") return reply(await call(`/ping?key=${encodeURIComponent(key)}`));
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

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
