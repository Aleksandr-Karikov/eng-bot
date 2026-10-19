/**
 * Эксперимент: текущие запоминалки трудных слов против новых (Sonnet + выбор приёма). Только чтение базы.
 *   npx tsx scripts/dev/try-mnemonics.ts [число слов]
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../../src/db/client";
import { cards, reviewLogs, words } from "../../src/db/schema";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

const limit = Number(process.argv[2] ?? 10);
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const forgot = await db
  .select({ wordId: cards.wordId })
  .from(reviewLogs)
  .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
  .where(eq(reviewLogs.rating, "again"));
const counts = new Map<number, number>();
for (const f of forgot) counts.set(f.wordId, (counts.get(f.wordId) ?? 0) + 1);
const all = await db.select({ id: words.id, term: words.term, translation: words.translation, mnemonic: words.mnemonic }).from(words);
const hard = all.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)).slice(0, limit);

const prompt = [
  "Ты помогаешь русскоязычным запомнить английские слова. Для каждого слова действуй в два шага.",
  "Шаг 1 — кандидаты. Набросай по одному варианту каждого приёма и честно оцени, насколько он поможет вспомнить значение (score 1–10):",
  "- image: яркий образ или созвучие с русским словом — только если созвучие естественное и само всплывает (beset → «бес сэт»: бесы окружили);",
  "- parts: разбор по частям или происхождение, если оно проясняет смысл (heritage ← heir, наследник);",
  "- link: связь со знакомым английским словом или корнем (fuse → fusion, confuse);",
  "- scene: короткая живая сценка употребления.",
  "Шаг 2 — итог. Собери запоминалку из лучших кандидатов: один, если сильный только один; два, если оба со score ≥ 7 и дополняют друг друга",
  "(например, образ + происхождение). 1–3 предложения, понятно с первого прочтения, без натяжек.",
  'Верни JSON-массив: [{"i": 1, "candidates": [{"technique": "image", "text": "...", "score": 8}, ...], "final": "...", "used": ["image", "parts"]}]',
  "",
  ...hard.map((w, i) => `${i + 1}. ${w.term} — ${w.translation}`),
].join("\n");

const claude = new ClaudeCodeEnricher({ model: "sonnet", timeoutMs: 180_000 });
const started = Date.now();
const raw = await claude.ask(prompt, 180_000);
const answer = z
  .array(
    z.object({
      i: z.number(),
      candidates: z.array(z.object({ technique: z.string(), text: z.string(), score: z.number() })),
      final: z.string(),
      used: z.array(z.string()),
    }),
  )
  .parse(JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)));
console.log(`sonnet: ${((Date.now() - started) / 1000).toFixed(0)} s for ${hard.length} words\n`);
for (const a of answer) {
  const w = hard[a.i - 1];
  if (!w) continue;
  console.log(`■ ${w.term} — ${w.translation}  (забыли ${counts.get(w.id) ?? 0} раз)`);
  console.log(`  сейчас: ${w.mnemonic || "—"}`);
  console.log(`  кандидаты: ${a.candidates.map((c) => `${c.technique} ${c.score}`).join(", ")}`);
  console.log(`  итог [${a.used.join(" + ")}]: ${a.final}\n`);
}
