/**
 * Какой LLM считает карточки — посмотреть и переключить, не заходя в бота.
 *   npx tsx scripts/llm.ts                       — кто сейчас (файл выбора и .env)
 *   npx tsx scripts/llm.ts openrouter            — переключить на OpenRouter
 *   npx tsx scripts/llm.ts claude-code           — вернуться на локальный Claude Code
 *   npx tsx scripts/llm.ts openrouter --check    — ещё и сходить в OpenRouter живым запросом
 *
 * Пишет тот же файл, что и команда /llm в боте (LLM_PROVIDER_FILE, по умолчанию data/llm-provider),
 * поэтому результат виден боту без перезапуска. .env не трогает: в нём ключи.
 *
 * Проверки «настроен ли OpenRouter» делает сам роутер — здесь они не повторяются, иначе правила
 * разъедутся с ботом и скрипт включит то, что бот потом откажется принять.
 */
import { loadConfig } from "../src/config";
import { isProvider, PROVIDERS, ProviderRouter } from "../src/llm/provider";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { readProvider, writeProvider } from "../src/llm/provider-store";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

// Скрипту BOT_TOKEN не нужен — он не поднимает бота, — но конфиг читается тот же, что у бота.
const config = loadConfig({ ...process.env, BOT_TOKEN: process.env.BOT_TOKEN || "unused-by-this-script" });
const path = config.llmProviderFile;
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("-"));
const saved = readProvider(path);

// Тот же роутер, что собирает src/index.ts, — чтобы скрипт и бот понимали «настроено» одинаково.
const router = new ProviderRouter({
  models: {
    claudeCode: { main: config.enrichModel, mnemonic: config.mnemonicModel, check: config.checkModel },
    openrouter: {
      main: config.openRouterModel ?? "",
      mnemonic: config.openRouterMnemonicModel ?? "",
      check: config.openRouterCheckModel ?? "",
    },
  },
  timeoutMs: config.enrichTimeoutMs,
  provider: saved ?? config.llmProvider,
  ...(config.openRouterKey ? { openRouter: new OpenRouterBackend({ apiKey: config.openRouterKey, title: "WordBoss" }) } : {}),
});

if (!target) {
  console.log(`Сейчас: ${router.provider}${saved ? "" : ` (из ${config.llmProvider === "openrouter" ? "LLM_PROVIDER" : "значения по умолчанию"})`}`);
  console.log(router.openRouterReady ? "OpenRouter настроен и доступен для переключения." : "OpenRouter не настроен: нужны OPEN_ROUTER_API_KEY и OPENROUTER_MODEL в .env.");
  console.log(`Выбор хранится в ${path}. Переключение: ${PROVIDERS.join(" | ")}`);
  process.exit(0);
}

if (!isProvider(target)) throw new Error(`Не знаю провайдера «${target}». Есть: ${PROVIDERS.join(", ")}`);
const result = router.tryUse(target);
if (!result.ok) throw new Error(result.error);

// Пишем только после того, как роутер принял переключение: иначе файл разошёлся бы с реальностью.
if (!writeProvider(path, target)) throw new Error(`Не удалось записать ${path}`);
console.log(result.previous === target ? `Уже ${target}.` : `Было ${result.previous} → стало ${target}. Бот подхватит без перезапуска.`);

if (args.includes("--check")) await check();

/** Живой запрос целиком: проверяет и ключ, и имя модели, и что ответ разбирается в карточку. */
async function check(): Promise<void> {
  if (router.provider !== "openrouter") {
    console.log("Проверка есть только для OpenRouter: Claude Code работает локально и ключа не требует.");
    return;
  }
  const card = await router.enrich("serendipity");
  console.log(`OpenRouter ответил: ${card.translation}`);
}
