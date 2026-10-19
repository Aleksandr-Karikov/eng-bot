import { checkText } from "../../src/bot/texts";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
for (const text of process.argv.slice(2)) {
  const started = Date.now();
  const result = await enricher.check(text);
  console.log(`--- "${text}" (${Date.now() - started} ms)\n${checkText(result)}\n`);
}
