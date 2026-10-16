import { checkText } from "../src/bot/texts";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";

const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const context = [
  { author: "Дима", text: "So what did you guys do last weekend?" },
  { author: "Катя", text: "We went hiking, it was amazing" },
];
const started = Date.now();
console.log(checkText(await enricher.check("I stay at home and watch the films all day", context)));
console.log(`took ${Date.now() - started} ms`);
