import { ClaudeCodeEnricher } from "../src/llm/claude-code";

const text =
  process.argv[2] ??
  "We took it for granted that the hangar would be empty, but by sheer serendipity we stumbled upon an old plane.";
const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const started = Date.now();
console.log(await enricher.extract(text));
console.log(`took ${Date.now() - started} ms`);
