/**
 * Переписывает объяснения, которые описывают слово только в одной реплике.
 *
 * npx tsx scripts/fix-context-explanations.ts [--dry-run]
 *
 * Баг #21: у `tug` объяснение было «В данном контексте 'tug at your heartstrings' означает…», а перевод —
 * «тянуть, дёргать, тащить». Человек видел три прямых значения и объяснение про переносное, и решал,
 * что от него требуют именно переносного. Реплика и так показывается отдельной строкой «Где встретилось»,
 * поэтому объяснение должно говорить о самом слове.
 *
 * Меняется ТОЛЬКО `explanation`; перевод, пример, контекст, запоминалка и прогресс не трогаются.
 */
import { eq } from "drizzle-orm";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { ProviderRouter } from "../src/llm/provider";
import { initialProvider } from "../src/llm/provider-store";
import { redactLogs } from "../src/log-redact";

try { process.loadEnvFile(".env"); } catch { /* .env необязателен */ }
const config = loadConfig({ ...process.env, BOT_TOKEN: process.env.BOT_TOKEN || "unused-by-this-script" });
redactLogs(config.botToken);
if (config.openRouterKey) redactLogs(config.openRouterKey, "<OPEN_ROUTER_API_KEY>");

const llm = new ProviderRouter({
  models: {
    claudeCode: { main: config.enrichModel, mnemonic: config.mnemonicModel, check: config.checkModel },
    openrouter: { main: config.openRouterModel ?? "", mnemonic: config.openRouterMnemonicModel ?? "", check: config.openRouterCheckModel ?? "" },
  },
  timeoutMs: config.enrichTimeoutMs,
  provider: initialProvider(config.llmProviderFile, config.llmProvider),
  ...(config.openRouterKey ? { openRouter: new OpenRouterBackend({ apiKey: config.openRouterKey, title: "WordBoss" }) } : {}),
});

const db = createDb(config.dbPath, { migrate: false });
const dryRun = process.argv.includes("--dry-run");

/** Признак: объяснение рассказывает про реплику, а не про слово. */
const CONTEXTY = /^(в данном контексте|здесь|в этом контексте|в этой реплике)/i;

const all = await db.select().from(words);
const todo = all.filter((w) => CONTEXTY.test((w.explanation ?? "").trim()));
console.log(`${todo.length} слов с контекстным объяснением; провайдер=${llm.provider}; dryRun=${dryRun}`);

let fixed = 0;
let failed = 0;
for (const word of todo) {
  try {
    // Перевод передаём как подсказку значения, контекст — чтобы модель знала, где слово встретилось.
    const enrichment = await llm.enrich(word.term, word.translation, word.context || undefined);
    const next = (enrichment.explanation ?? "").trim();
    if (!next) {
      failed++;
      console.log(`#${word.id} ${word.term}: модель не дала объяснения`);
      continue;
    }
    if (CONTEXTY.test(next)) {
      failed++;
      console.log(`#${word.id} ${word.term}: всё ещё про контекст — ${next.slice(0, 80)}`);
      continue;
    }
    console.log(`#${word.id} ${word.term}\n   было:  ${(word.explanation ?? "").slice(0, 100)}\n   стало: ${next.slice(0, 100)}`);
    if (!dryRun) await db.update(words).set({ explanation: next }).where(eq(words.id, word.id));
    fixed++;
  } catch (err) {
    failed++;
    console.error(`#${word.id} ${word.term}: не вышло —`, err instanceof Error ? err.message : err);
  }
}
console.log(`\nитог: исправлено ${fixed}, не вышло ${failed} из ${todo.length}`);
