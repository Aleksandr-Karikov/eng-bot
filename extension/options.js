const $ = (id) => document.getElementById(id);

chrome.runtime.sendMessage({ type: "settings" }).then(({ key = "", server = "" }) => {
  $("key").value = key;
  $("server").value = server;
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ key: $("key").value.trim(), server: $("server").value.trim() });
  const status = $("status");
  status.className = "";
  status.textContent = "Проверяю…";
  const res = await chrome.runtime.sendMessage({ type: "ping" });
  status.className = res.ok ? "ok" : "err";
  status.textContent = res.ok
    ? `✓ Привет, ${res.name}! Слова пойдут в комнату «${res.room ?? "не выбрана — выбери в боте /room"}».`
    : `✗ ${res.error}`;
});
