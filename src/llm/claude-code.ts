import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt, parseEnrichment, SYSTEM_PROMPT, type Enrichment, type WordEnricher } from "./enricher";

/** Ходит в локальный Claude Code через Agent SDK (авторизация Claude Code, без API-ключа). */
export class ClaudeCodeEnricher implements WordEnricher {
  constructor(private readonly opts: { model: string; timeoutMs: number }) {}

  async enrich(term: string, translationHint?: string): Promise<Enrichment> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.opts.timeoutMs);
    try {
      let result: string | undefined;
      for await (const message of query({
        prompt: buildPrompt(term, translationHint),
        options: {
          abortController,
          model: this.opts.model,
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 1,
          // Без инструментов и без пользовательских настроек/плагинов/хуков — только ответ модели.
          tools: [],
          settingSources: [],
        },
      })) {
        if (message.type === "result") {
          if (message.subtype !== "success") throw new Error(`Claude Code failed: ${message.subtype}`);
          result = message.result;
        }
      }
      if (result === undefined) throw new Error("Claude Code returned no result");
      return parseEnrichment(result);
    } finally {
      clearTimeout(timer);
    }
  }
}
