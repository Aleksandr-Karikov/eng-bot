import { clozeFull, clozeJudgedText } from "../../src/bot/texts";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const term = process.argv[2] ?? "take for granted";
const translation = process.argv[3] ?? "принимать как должное";

let started = Date.now();
const sentences = await claude.cloze(term, translation);
console.log(`cloze (${Date.now() - started} ms):`);
for (const s of sentences) console.log(`- ${s.sentence}  [${s.answer}]  ${s.translation}`);

const s = { ...sentences[0], id: 0, wordId: 0, createdAt: new Date() };
for (const answer of ["assumed", "took for granted", "banana"]) {
  started = Date.now();
  const j = await claude.judge({ sentence: s.sentence, expected: s.answer, term, translation, answer });
  console.log(`\n--- answer "${answer}" (${Date.now() - started} ms)\n${clozeJudgedText(s, j)}`);
}
void clozeFull;
