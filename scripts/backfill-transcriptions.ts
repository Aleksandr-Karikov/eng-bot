/**
 * Дозаполняет британскую и американскую транскрипцию словам, у которых её нет.
 *   npx tsx scripts/backfill-transcriptions.ts --dry-run   — только показать
 *   npx tsx scripts/backfill-transcriptions.ts             — записать в базу
 */
import { eq, or } from "drizzle-orm";
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
const CHUNK = 40;
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite");
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 180_000 });
const answerSchema = z.array(
  z.object({ i: z.number(), transcription_uk: z.string().default(""), transcription_us: z.string().default("") }),
);

const missing = await db.select().from(words).where(or(eq(words.transcriptionUk, ""), eq(words.transcriptionUs, "")));
console.log(`Without transcription: ${missing.length}${dryRun ? " (dry run)" : ""}`);

let updated = 0;
for (let start = 0; start < missing.length; start += CHUNK) {
  const chunk = missing.slice(start, start + CHUNK);
  const prompt = [
    "Дай транскрипцию IPA в британском (RP) и американском произношении для каждого пункта, в слешах; для фразы — целиком.",
    'Верни JSON-массив: [{"i": 1, "transcription_uk": "...", "transcription_us": "..."}], i — номер пункта.',
    "",
    ...chunk.map((w, i) => `${i + 1}. ${w.term}`),
  ].join("\n");
  const raw = await claude.ask(prompt, 180_000);
  const answer = answerSchema.parse(JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)));
  for (const { i, transcription_uk, transcription_us } of answer) {
    const word = chunk[i - 1];
    if (!word) continue;
    console.log(`${word.term}: UK ${transcription_uk} · US ${transcription_us}`);
    if (!dryRun) {
      await db
        .update(words)
        .set({
          transcriptionUk: word.transcriptionUk || transcription_uk.trim(),
          transcriptionUs: word.transcriptionUs || transcription_us.trim(),
        })
        .where(eq(words.id, word.id));
    }
    updated++;
  }
}
console.log(`${dryRun ? "Would update" : "Updated"}: ${updated}`);
