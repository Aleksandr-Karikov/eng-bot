/**
 * Пересчитывает полезность отдельных слов по частотности (wordfreq) — так же, как при добавлении.
 * Грубое, устаревшее и жаргон (по пояснению модели) остаются необязательными. Фразы не трогает.
 *   npx tsx scripts/rerate-usefulness.ts [--dry-run]
 */
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { WordfreqSource } from "../src/frequency/frequency";
import { applyFrequency, singleWord } from "../src/services/usefulness";
import { setUsefulness } from "../src/services/words";

const NICHE_NOTE = /груб|ругат|устар|жаргон|сериал|архаи/i;
const dryRun = process.argv.includes("--dry-run");
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const all = (await db.select().from(words)).filter((w) => singleWord(w.term));
const rated = await applyFrequency(
  all.map((w) => ({ id: w.id, term: w.term, usefulness: w.usefulness, usefulnessNote: w.usefulnessNote, niche: w.usefulness === 1 && NICHE_NOTE.test(w.usefulnessNote) })),
  new WordfreqSource("tools/wordfreq/.venv/bin/python", "tools/wordfreq/zipf.py"),
);
const icons = ["", "⚪️", "🟡", "🟢"];
let changed = 0;
for (const [i, r] of rated.entries()) {
  const before = all[i];
  if (r.usefulness === before.usefulness) continue;
  changed++;
  console.log(`${icons[before.usefulness ?? 0] || "·"} → ${icons[r.usefulness ?? 0]} ${before.term} — ${r.usefulnessNote}`);
  if (!dryRun && r.usefulness) await setUsefulness(db, before.id, r.usefulness, r.usefulnessNote ?? "");
}
console.log(`\n${changed} of ${all.length} single words changed${dryRun ? " (dry run)" : ""}`);
