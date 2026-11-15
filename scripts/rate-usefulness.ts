/**
 * Заполняет отсутствующие оценки, не меняя слова и прогресс.
 * npx tsx scripts/rate-usefulness.ts [--all] [--dry-run]
 * Ручные оценки не трогает; провайдер и язык — как у бота.
 */
import { existsSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { WordfreqSource } from "../src/frequency/frequency";
import { withLang } from "../src/lang";
import { redactLogs } from "../src/log-redact";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { ProviderRouter } from "../src/llm/provider";
import { initialProvider } from "../src/llm/provider-store";
import { rateUsefulness } from "../src/services/usefulness";
import { wordLanguage } from "../src/services/words";

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
const frequency = existsSync(config.wordfreqPython) ? new WordfreqSource(config.wordfreqPython, "tools/wordfreq/zipf.py") : undefined;
const all = process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");
const todo = (await db.select().from(words)).filter((w) => w.usefulnessNote !== "отмечено вручную как полезное" && (all || w.usefulness === null));
console.log(`${todo.length} words to rate; provider=${llm.provider}; dryRun=${dryRun}`);
for (const word of todo) {
  try {
    const enrichment = await withLang(await wordLanguage(db, word.id), () => llm.enrich(word.term, word.translation));
    const [rated] = await rateUsefulness([{ ...enrichment, term: word.term }], frequency);
    if (!rated.usefulness) {
      console.log(`#${word.id}: недостаточно данных для оценки`);
      continue;
    }
    console.log(`#${word.id}: ${word.usefulness ?? "?"} → ${rated.usefulness} (${rated.usefulnessNote})`);
    if (!dryRun) await db.update(words).set({ usefulness: rated.usefulness, usefulnessNote: rated.usefulnessNote ?? "" }).where(and(
      eq(words.id, word.id), eq(words.term, word.term), eq(words.translation, word.translation),
      eq(words.usefulnessNote, word.usefulnessNote),
      word.usefulness === null ? isNull(words.usefulness) : eq(words.usefulness, word.usefulness),
    ));
  } catch (err) {
    console.error(`#${word.id}: rating failed`, err instanceof Error ? err.name : "unknown error");
    process.exitCode = 1;
  }
}
