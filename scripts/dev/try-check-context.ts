import { checkText } from "../../src/bot/texts";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";

/** npx tsx scripts/dev/try-check-context.ts "проверяемый текст" "Автор: предыдущее" "Автор: ещё одно" */
const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const [text = "ths", ...rest] = process.argv.slice(2);
const context = (rest.length ? rest : ["Александр: Have a good time"]).map((line) => {
  const [author, ...words] = line.split(": ");
  return { author, text: words.join(": ") };
});
for (let i = 0; i < 3; i++) {
  const started = Date.now();
  const result = checkText(await enricher.check(text, context));
  console.log(`--- run ${i + 1} (${Date.now() - started} ms)\n${result}\n`);
}
