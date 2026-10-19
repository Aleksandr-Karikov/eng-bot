/**
 * Оценивает полезность слов, у которых её ещё нет (🟢/🟡/⚪️), пачками по 25.
 *   npx tsx scripts/backfill-usefulness.ts [--dry-run]
 */
import { isNull } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { USEFULNESS_HINT } from "../src/llm/enricher";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import { jsonObject } from "../src/llm/tutor";
import { setUsefulness } from "../src/services/words";

const CHUNK = 25;
const LEVELS: Record<string, 1 | 2 | 3> = { high: 3, medium: 2, low: 1 };
const dryRun = process.argv.includes("--dry-run");
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 120_000 });
const todo = await db.select().from(words).where(isNull(words.usefulness));
console.log(`${todo.length} words without usefulness`);

const answer = z.object({
  items: z.array(z.object({ i: z.number().int(), usefulness: z.string(), usefulness_note: z.string().default("") })),
});
const counts = { 3: 0, 2: 0, 1: 0 } as Record<number, number>;
for (let start = 0; start < todo.length; start += CHUNK) {
  const chunk = todo.slice(start, start + CHUNK);
  const prompt = [
    "Оцени каждое английское слово или фразу из списка.",
    USEFULNESS_HINT,
    'Верни JSON: {"items": [{"i": 1, "usefulness": "high|medium|low", "usefulness_note": "..."}]}',
    "",
    ...chunk.map((w, k) => `${k + 1}. ${w.term} — ${w.translation}`),
  ].join("\n");
  try {
    const parsed = answer.parse(jsonObject(await claude.ask(prompt, 120_000)));
    for (const item of parsed.items) {
      const word = chunk[item.i - 1];
      const level = LEVELS[item.usefulness.toLowerCase()];
      if (!word || !level) continue;
      counts[level]++;
      console.log(`${["", "⚪️", "🟡", "🟢"][level]} ${word.term} — ${item.usefulness_note}`);
      if (!dryRun) await setUsefulness(db, word.id, level, item.usefulness_note);
    }
  } catch (err) {
    console.error(`Chunk ${start / CHUNK + 1} failed, continuing`, err);
  }
}
console.log(`\n🟢 ${counts[3]} · 🟡 ${counts[2]} · ⚪️ ${counts[1]}${dryRun ? " (dry run)" : ""}`);
