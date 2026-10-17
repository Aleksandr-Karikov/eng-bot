/**
 * Дописывает запоминалки словам, у которых их нет (по 20 слов на запрос к Claude).
 *   npx tsx scripts/backfill-mnemonics.ts --dry-run   — только показать
 *   npx tsx scripts/backfill-mnemonics.ts             — записать в базу
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const dryRun = process.argv.includes("--dry-run");
const CHUNK = 20;
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 180_000 });
const answerSchema = z.array(z.object({ i: z.number(), mnemonic: z.string().trim().min(1) }));

const missing = await db
  .select({ id: words.id, term: words.term, translation: words.translation })
  .from(words)
  .where(eq(words.mnemonic, ""));
console.log(`Without mnemonic: ${missing.length}${dryRun ? " (dry run)" : ""}`);

let updated = 0;
for (let start = 0; start < missing.length; start += CHUNK) {
  const chunk = missing.slice(start, start + CHUNK);
  const prompt = [
    "Для каждого английского слова или фразы придумай запоминалку по-русски в 1–2 предложения: созвучие с русским словом",
    "или яркий образ, который связывает звучание английского со значением (например: «beset» звучит как «бес сэт» — толпа бесов",
    "осадила тебя со всех сторон).",
    'Верни JSON-массив: [{"i": 1, "mnemonic": "..."}], i — номер пункта.',
    "",
    ...chunk.map((w, i) => `${i + 1}. ${w.term} — ${w.translation}`),
  ].join("\n");
  const raw = await claude.ask(prompt, 180_000);
  const answer = answerSchema.parse(JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)));
  for (const { i, mnemonic } of answer) {
    const word = chunk[i - 1];
    if (!word) continue;
    console.log(`${word.term}: ${mnemonic}`);
    if (!dryRun) await db.update(words).set({ mnemonic }).where(eq(words.id, word.id));
    updated++;
  }
}
console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
