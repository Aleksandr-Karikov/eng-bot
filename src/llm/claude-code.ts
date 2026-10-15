import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildExtractPrompt,
  buildPrompt,
  parseEnrichment,
  parseExtraction,
  SYSTEM_PROMPT,
  type Enrichment,
  type ExtractedItem,
  type WordEnricher,
} from "./enricher";

/** Разбор списка до 50 пунктов отвечает намного дольше, чем подсказка к одному слову. */
const EXTRACT_TIMEOUT_MS = 120_000;

/** Ходит в локальный Claude Code через Agent SDK (авторизация Claude Code, без API-ключа). */
export class ClaudeCodeEnricher implements WordEnricher {
  constructor(private readonly opts: { model: string; timeoutMs: number }) {}

  async enrich(term: string, translationHint?: string): Promise<Enrichment> {
    return parseEnrichment(await this.ask(buildPrompt(term, translationHint), this.opts.timeoutMs));
  }

  async extract(text: string): Promise<ExtractedItem[]> {
    return parseExtraction(await this.ask(buildExtractPrompt(text), Math.max(this.opts.timeoutMs, EXTRACT_TIMEOUT_MS)));
  }

  private async ask(prompt: string, timeoutMs: number): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      let result: string | undefined;
      for await (const message of query({
        prompt,
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
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
