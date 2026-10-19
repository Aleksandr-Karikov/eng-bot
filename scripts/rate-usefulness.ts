/**
 * Оценивает полезность слов по тем же правилам, что и при добавлении (services/usefulness):
 * модель отвечает на вопросы о значении, регистре и (для фраз) частоте, частотность слов — wordfreq.
 *   npx tsx scripts/rate-usefulness.ts [--all] [--dry-run]   — без --all только слова без оценки
 * Отмеченные вручную («⭐ Сделать полезным») не трогает.
 */
import { z } from "zod";
import { createDb } from "../src/db/client";
import { words } from "../src/db/schema";
import { WordfreqSource } from "../src/frequency/frequency";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import { PHRASE_FREQUENCIES, REGISTERS, SENSES, USEFULNESS_HINT } from "../src/llm/enricher";
import { jsonObject } from "../src/llm/tutor";
import { rateUsefulness } from "../src/services/usefulness";
import { setUsefulness } from "../src/services/words";

const CHUNK = 25;
const MANUAL = "отмечено вручную как полезное";
const all = process.argv.includes("--all");
const dryRun = process.argv.includes("--dry-run");
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 120_000 });
const frequency = new WordfreqSource("tools/wordfreq/.venv/bin/python", "tools/wordfreq/zipf.py");
const todo = (await db.select().from(words)).filter((w) => w.usefulnessNote !== MANUAL && (all || w.usefulness === null));
console.log(`${todo.length} words to rate`);

const pick = <T extends readonly string[]>(values: T, v: unknown) => ((values as readonly string[]).includes(String(v).toLowerCase()) ? (String(v).toLowerCase() as T[number]) : undefined);
const answer = z.object({ items: z.array(z.object({ i: z.number().int(), sense: z.unknown(), register: z.unknown(), phrase_frequency: z.unknown() })) });
const icons = ["·", "⚪️", "🟡", "🟢"];
const counts = [0, 0, 0, 0];
for (let start = 0; start < todo.length; start += CHUNK) {
  const chunk = todo.slice(start, start + CHUNK);
  const prompt = [
    "Для каждого английского слова или фразы из списка (в указанном значении) ответь на вопросы:",
    USEFULNESS_HINT,
    'Верни JSON: {"items": [{"i": 1, "sense": "main", "register": "neutral", "phrase_frequency": ""}]}',
    "",
    ...chunk.map((w, k) => `${k + 1}. ${w.term} — ${w.translation}`),
  ].join("\n");
  try {
    const facts = answer.parse(jsonObject(await claude.ask(prompt, 120_000))).items;
    const items = chunk.map((w, k) => {
      const f = facts.find((x) => x.i === k + 1);
      return { id: w.id, term: w.term, before: w.usefulness, sense: pick(SENSES, f?.sense), register: pick(REGISTERS, f?.register), phraseFrequency: pick(PHRASE_FREQUENCIES, f?.phrase_frequency) };
    });
    for (const r of await rateUsefulness(items, frequency)) {
      const level = (r as { usefulness?: number }).usefulness;
      if (!level) continue;
      counts[level]++;
      const note = (r as { usefulnessNote?: string }).usefulnessNote ?? "";
      console.log(`${icons[r.before ?? 0]} → ${icons[level]} ${r.term} — ${note}`);
      if (!dryRun) await setUsefulness(db, r.id, level, note);
    }
  } catch (err) {
    console.error(`Chunk ${start / CHUNK + 1} failed, continuing`, err);
  }
}
console.log(`\n🟢 ${counts[3]} · 🟡 ${counts[2]} · ⚪️ ${counts[1]}${dryRun ? " (dry run)" : ""}`);
