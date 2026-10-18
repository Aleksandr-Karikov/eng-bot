/**
 * Запоминалки новым механизмом (Sonnet, два шага) — для слов без запоминалки или для всех (--all).
 *   npx tsx scripts/backfill-mnemonics.ts --dry-run [--all]   — только показать
 *   npx tsx scripts/backfill-mnemonics.ts [--all]             — записать в базу
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const dryRun = process.argv.includes("--dry-run");
const all = process.argv.includes("--all");
const CHUNK = 20;
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 180_000, mnemonicModel: process.env.MNEMONIC_MODEL || "sonnet" });

const rows = await db.select({ id: words.id, term: words.term, translation: words.translation, mnemonic: words.mnemonic }).from(words);
const targets = all ? rows : rows.filter((w) => !w.mnemonic);
console.log(`${all ? "All words" : "Without mnemonic"}: ${targets.length}${dryRun ? " (dry run)" : ""}`);

let updated = 0;
for (let start = 0; start < targets.length; start += CHUNK) {
  const chunk = targets.slice(start, start + CHUNK);
  const finals = await claude.mnemonics(chunk.map((w) => ({ term: w.term, translation: w.translation })));
  for (const [k, word] of chunk.entries()) {
    if (!finals[k]) continue;
    console.log(`■ ${word.term}: ${finals[k]}`);
    if (!dryRun) await db.update(words).set({ mnemonic: finals[k] }).where(eq(words.id, word.id));
    updated++;
  }
}
console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
