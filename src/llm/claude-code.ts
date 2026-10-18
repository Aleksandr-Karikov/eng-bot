import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildCheckPrompt,
  buildExtractPrompt,
  buildPrompt,
  parseEnrichment,
  parseCheck,
  parseExtraction,
  SYSTEM_PROMPT,
  type CheckResult,
  type ContextMessage,
  type Enrichment,
  type ExtractedItem,
  type WordEnricher,
} from "./enricher";
import {
  buildClozePrompt,
  buildDrillPrompt,
  buildJudgePrompt,
  buildSentencePrompt,
  buildStoryPrompt,
  parseStory,
  type StoryDraft,
  parseSentenceReview,
  type SentenceInput,
  type SentenceReview,
  buildImagePromptPrompt,
  buildMnemonicPrompt,
  parseCloze,
  parseDrill,
  parseJudgement,
  parseImagePrompt,
  parseMnemonics,
  type DrillQuestion,
  type ExerciseTutor,
  type ImageSubject,
  type MnemonicItem,
  type JudgeInput,
  type Judgement,
} from "./tutor";
import type { ClozeDraft } from "../services/cloze";

/** Разбор списка до 100 пунктов отвечает намного дольше, чем подсказка к одному слову (46 пунктов ≈ 30 с). */
const EXTRACT_TIMEOUT_MS = 180_000;

/** Ходит в локальный Claude Code через Agent SDK (авторизация Claude Code, без API-ключа). */
export class ClaudeCodeEnricher implements WordEnricher, ExerciseTutor {
  constructor(private readonly opts: { model: string; timeoutMs: number; mnemonicModel?: string }) {}

  async enrich(term: string, translationHint?: string): Promise<Enrichment> {
    return parseEnrichment(await this.ask(buildPrompt(term, translationHint), this.opts.timeoutMs));
  }

  async extract(text: string): Promise<ExtractedItem[]> {
    return parseExtraction(await this.ask(buildExtractPrompt(text), Math.max(this.opts.timeoutMs, EXTRACT_TIMEOUT_MS)));
  }

  async check(text: string, context?: ContextMessage[], author?: string, leadIn?: string[]): Promise<CheckResult> {
    return parseCheck(await this.ask(buildCheckPrompt(text, context, author, leadIn), this.opts.timeoutMs));
  }

  async cloze(term: string, translation: string): Promise<ClozeDraft[]> {
    return parseCloze(await this.ask(buildClozePrompt(term, translation), Math.max(this.opts.timeoutMs, 60_000)));
  }

  async drill(profile: string, count: number): Promise<DrillQuestion[]> {
    return parseDrill(await this.ask(buildDrillPrompt(profile, count), Math.max(this.opts.timeoutMs, 60_000)));
  }

  /** Запоминалки — более сильной моделью (по умолчанию sonnet): придумывать ассоциации Haiku умеет плохо. */
  async mnemonics(items: MnemonicItem[]): Promise<string[]> {
    if (items.length === 0) return [];
    const raw = await this.ask(buildMnemonicPrompt(items), Math.max(this.opts.timeoutMs, 30_000 + items.length * 6_000), this.opts.mnemonicModel ?? "sonnet");
    return parseMnemonics(raw, items.length);
  }

  /** Сцена для картинки — тоже сильной моделью: Haiku часто рисует случайную обстановку вместо смысла. */
  async imagePrompt(word: ImageSubject): Promise<string> {
    const raw = await this.ask(buildImagePromptPrompt(word), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet");
    return parseImagePrompt(raw);
  }

  /** История — сильной моделью: Haiku пишет скучно и натягивает слова. */
  async story(words: Array<{ term: string; translation: string }>): Promise<StoryDraft> {
    return parseStory(await this.ask(buildStoryPrompt(words), Math.max(this.opts.timeoutMs, 120_000), this.opts.mnemonicModel ?? "sonnet"));
  }

  async reviewSentence(input: SentenceInput): Promise<SentenceReview> {
    return parseSentenceReview(await this.ask(buildSentencePrompt(input), Math.max(this.opts.timeoutMs, 45_000)));
  }

  async judge(input: JudgeInput): Promise<Judgement> {
    return parseJudgement(await this.ask(buildJudgePrompt(input), this.opts.timeoutMs));
  }

  /** Один запрос к Claude Code без инструментов; возвращает текст ответа. */
  async ask(prompt: string, timeoutMs: number, model = this.opts.model): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      let result: string | undefined;
      for await (const message of query({
        prompt,
        options: {
          abortController,
          model,
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
