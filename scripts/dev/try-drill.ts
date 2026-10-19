import { drillResultText } from "../../src/bot/texts";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const texts = ["Tomorrow I go to my mom, she wait me", "Yesterday I am watching film with friends", "I live in Moscow since 2015"];

const fixes = [];
for (const t of texts) {
  const r = await claude.check(t);
  for (const f of r.fixes) console.log(`[${f.category}] ${f.wrong} → ${f.right}`);
  fixes.push(...r.fixes);
}

const byCat = new Map<string, string[]>();
for (const f of fixes) byCat.set(f.category ?? "другое", [...(byCat.get(f.category ?? "другое") ?? []), `${f.wrong} → ${f.right}`]);
const profile = [...byCat].map(([c, ex]) => `${c} ×${ex.length}: ${ex.slice(0, 2).join("; ")}`).join("\n");
console.log(`\nprofile:\n${profile}\n`);

const started = Date.now();
const qs = await claude.drill(profile, 3);
console.log(`drill (${Date.now() - started} ms):`);
for (const q of qs) console.log(`\n${q.question}\n  ${q.options.map((o, i) => (i === q.correct ? `[${o}]` : o)).join(" | ")}\n  ${drillResultText(q, q.correct).split("\n\n").at(-1)}`);
