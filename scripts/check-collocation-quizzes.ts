/**
 * Проверяет вопросы на сочетания у уже сохранённых слов и убирает негодные.
 *
 * npx tsx scripts/check-collocation-quizzes.ts [--dry-run] [--limit=N]
 *
 * Вопрос годится, только если ровно один вариант даёт осмысленное предложение. До этой проверки
 * (баг #20) сохранялись вопросы, где «верный» вариант подставлялся в бессмыслицу: у `addictive`
 * верным стояло `highly` — «This new video game is so highly that I can't stop playing».
 *
 * Сочетания (`items`) не трогаются: они полезны и без вопроса. Негодный вопрос удаляется из
 * `collocations`, остальные поля слова остаются как были.
 */
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { ProviderRouter } from "../src/llm/provider";
import { initialProvider } from "../src/llm/provider-store";
import { redactLogs } from "../src/log-redact";
import type { Collocations } from "../src/llm/tutor";
import { validQuiz } from "../src/services/collocations";

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
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;

const all = await db.select().from(words);
const withQuiz = all.filter((w) => {
  if (!w.collocations) return false;
  try {
    return Boolean((JSON.parse(w.collocations) as Collocations).quiz);
  } catch {
    return false;
  }
});
console.log(`${withQuiz.length} слов с вопросом; провайдер=${llm.provider}; dryRun=${dryRun}`);

let rejected = 0;
let kept = 0;
let failed = 0;
for (const word of withQuiz.slice(0, limit)) {
  const collocations = JSON.parse(word.collocations) as Collocations;
  const quiz = collocations.quiz!;
  const drop = (why: string) => {
    rejected++;
    console.log(`#${word.id} ${word.term}: убрать вопрос — ${why}`);
  };
  // Дешёвая проверка без модели: ответ не должен быть самим словом (это уже ловилось, но у старых записей).
  if (!validQuiz(quiz, word.term)) {
    drop("ответ — само слово или его часть");
  } else if (!llm.checkCollocationQuiz) {
    failed++;
    continue;
  } else {
    try {
      const check = await llm.checkCollocationQuiz({ term: word.term, translation: word.translation, quiz: { term: word.term, ...quiz } });
      if (check.ok) {
        kept++;
        continue;
      }
      drop(check.why || "подстановка даёт неверное предложение");
    } catch (err) {
      failed++;
      console.error(`#${word.id} ${word.term}: проверить не удалось —`, err instanceof Error ? err.message : err);
      continue;
    }
  }
  if (!dryRun) {
    const rest: Collocations = { items: collocations.items };
    await db.update(words).set({ collocations: JSON.stringify(rest) }).where(eq(words.id, word.id));
  }
}
console.log(`\nитог: проверено ${withQuiz.slice(0, limit).length}, оставлено ${kept}, убрано ${rejected}, ошибок ${failed}`);
