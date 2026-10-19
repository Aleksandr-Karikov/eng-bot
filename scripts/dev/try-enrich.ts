import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

const term = process.argv[2] ?? "serendipity";
const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const started = Date.now();
console.log(await enricher.enrich(term, process.argv[3]));
console.log(`took ${Date.now() - started} ms`);
