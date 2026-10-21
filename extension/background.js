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
