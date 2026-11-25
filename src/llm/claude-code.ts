import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { EN, type Language } from "../lang";
import { Limiter } from "./limiter";
import type { LlmBackend } from "./backend";
import {
  buildCheckPrompt,
  buildExampleTranslationPrompt,
  dataNotInstructionsPrompt,
  dictionaryFormPrompt,
  buildCorrectionPrompt,
  parseCorrection,
  parseExampleTranslation,
  type CorrectionWord,
  type WordCorrection,
  buildExtractPrompt,
  buildPrompt,
  parseEnrichment,
  parseCheck,
  parseExtraction,
  systemPrompt,
  type CheckResult,
  type ContextMessage,
  type Enrichment,
  type ExtractedItem,
  type ImageInput,
  buildExtractImagePrompt,
  buildReadImagePrompt,
  type WordEnricher,
} from "./enricher";
import {
  buildClozePrompt,
  buildDrillPrompt,
  buildDrillReviewPrompt,
  parseDrillReview,
  buildQuizCheckPrompt,
  parseQuizCheck,
  type QuizCheck,
  buildJudgePrompt,
  buildSentencePrompt,
  buildDialoguePrompt,
  buildStoryPrompt,
  buildUntanglePrompt,
  buildTalkReplyPrompt,
  buildExplainGrammarPrompt,
  buildSayPrompt,
  buildCollocationsPrompt,
  buildTranslationTaskPrompt,
  buildTranslationReviewPrompt,
  parseTranslationTask,
  parseTranslationReview,
  type TranslationInput,
  type TranslationReview,
  type TranslationTask,
  parseCollocations,
  type Collocations,
  buildGrammarPrompt,
  parseGrammar,
  type WordGrammar,
  parseExplainGrammar,
  parseSayAnswer,
  type SayAnswer,
  buildTalkReviewPrompt,
  parseTalkReply,
  parseTalkReview,
  type TalkInput,
  type TalkReview,
  parseLeechHelp,
  type LeechHelp,
  parseStory,
  type StoryDraft,
  parseSentenceReview,
  parseDialogueScene,
  type DialogueInput,
  type DialogueScene,
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

/**
 * Потолок для перевода в инлайн-режиме: Telegram ждёт ответ около 10 секунд и потом просто не показывает
 * подсказки. Обычный `timeoutMs` — 30 с, то есть медленный запрос «съел» бы весь бюджет и человек увидел бы
 * пустоту вместо карточки. Здесь жёстко 6 с: не успели — честно показываем «открыть бота».
 */
const INLINE_TRANSLATE_TIMEOUT_MS = 6_000;

/** Ходит в локальный Claude Code через Agent SDK (авторизация Claude Code, без API-ключа). */
export class ClaudeCodeBackend implements LlmBackend {
  readonly name = "claude-code";

  /**
   * `_lang` — часть контракта `LlmBackend` (тест закрепляет, что бэкенд получает английский), но
   * самому провайдеру язык не нужен: промпт уже собран на нужном языке выше.
   */
  async ask(prompt: string, timeoutMs: number, model: string, images: ImageInput[], _lang: Language): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      let result: string | undefined;
      for await (const message of query({
        prompt: images.length ? withImages(prompt, images) : prompt,
        options: {
          abortController,
          model,
          systemPrompt: systemPrompt(),
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

/** Сообщение с картинками: SDK принимает их только в потоковом вводе, одним сообщением пользователя. */
async function* withImages(text: string, images: ImageInput[]): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data.toString("base64") } })),
        { type: "text" as const, text },
      ],
    },
  };
}

/**
 * Все 19 методов `WordEnricher` + `ExerciseTutor`: собирает промпт, разбирает ответ, выбирает модель.
 * Сам в модель не ходит — это делает `backend`, поэтому один и тот же класс обслуживает и Claude Code,
 * и OpenRouter (см. `provider.ts`).
 *
 * Имя историческое: класс начинался как «обёртка над Claude Code» и переименование затронуло бы десяток
 * мест без пользы. Читайте его как «слой методов поверх бэкенда».
 */
export class ClaudeCodeEnricher implements WordEnricher, ExerciseTutor {
  /** Одновременно — не больше трёх запросов: у Claude Code каждый — отдельный процесс, Мак их не тянет. */
  private readonly limiter = new Limiter(3);

  /**
   * checkModel — для проверок (/check, ответы в упражнениях, перевод): ошибка здесь подаётся человеку как факт,
   * поэтому сильнее основной модели. По умолчанию sonnet.
   * backend — куда ходить; по умолчанию локальный Claude Code (тесты подставляют свой).
   */
  constructor(
    private readonly opts: { model: string; timeoutMs: number; mnemonicModel?: string; checkModel?: string },
    private readonly backend: LlmBackend = new ClaudeCodeBackend(),
  ) {}

  private get checker(): string {
    return this.opts.checkModel ?? "sonnet";
  }

  async enrich(term: string, translationHint?: string, context?: string): Promise<Enrichment> {
    return parseEnrichment(await this.ask(dictionaryFormPrompt(buildPrompt(term, translationHint, context)), this.opts.timeoutMs));
  }

  async correctWord(word: CorrectionWord, instruction: string): Promise<WordCorrection> {
    return parseCorrection(await this.ask(buildCorrectionPrompt(word, instruction), Math.max(this.opts.timeoutMs, 60_000), this.checker));
  }

  /** Перевод примера — обычной моделью: перевести готовое предложение ей хватает. */
  async translateExample(example: string, term: string): Promise<string> {
    const translation = parseExampleTranslation(await this.ask(buildExampleTranslationPrompt(example, term), Math.max(this.opts.timeoutMs, 30_000)));
    if (!translation) throw new Error("Empty example translation");
    return translation;
  }

  /**
   * Перевод одного слова с жёстким потолком времени — для инлайн-режима.
   *
   * Отличие от `enrich` только в таймауте (см. INLINE_TRANSLATE_TIMEOUT_MS), промпт и разбор те же:
   * отдельный промпт здесь означал бы вторую реализацию одного и того же, которая разъедется с первой.
   */
  async enrichFast(term: string): Promise<Enrichment> {
    return parseEnrichment(await this.ask(dictionaryFormPrompt(buildPrompt(term, undefined, undefined)), INLINE_TRANSLATE_TIMEOUT_MS));
  }

  async extract(text: string): Promise<ExtractedItem[]> {
    return parseExtraction(await this.ask(dictionaryFormPrompt(dataNotInstructionsPrompt(buildExtractPrompt(text))), Math.max(this.opts.timeoutMs, EXTRACT_TIMEOUT_MS)));
  }

  async extractImage(image: ImageInput, note?: string): Promise<ExtractedItem[]> {
    const raw = await this.ask(dictionaryFormPrompt(buildExtractImagePrompt(note)), Math.max(this.opts.timeoutMs, EXTRACT_TIMEOUT_MS), this.opts.model, [image]);
    const items = parseExtraction(raw);
    // Пусто — чтобы было видно почему: что за файл пришёл и что ответила модель.
    if (items.length === 0) {
      console.warn(`Image extraction found nothing: ${image.data.length} bytes, ${image.mediaType}, starts ${image.data.subarray(0, 4).toString("hex")}; answer: ${raw.slice(0, 300)}`);
    }
    return items;
  }

  async readImage(image: ImageInput): Promise<string> {
    const raw = (await this.ask(buildReadImagePrompt(), Math.max(this.opts.timeoutMs, EXTRACT_TIMEOUT_MS), this.opts.model, [image]))
      .replace(/^```\w*\n?|```$/g, "")
      .trim();
    // Модель иногда всё равно заворачивает ответ в JSON: {"text": "..."}.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") return parsed.trim();
      if (parsed && typeof parsed === "object" && typeof (parsed as { text?: unknown }).text === "string") return (parsed as { text: string }).text.trim();
    } catch {
      // обычный текст
    }
    return raw;
  }

  async check(text: string, context?: ContextMessage[], author?: string, leadIn?: string[]): Promise<CheckResult> {
    return parseCheck(await this.ask(dataNotInstructionsPrompt(buildCheckPrompt(text, context, author, leadIn)), Math.max(this.opts.timeoutMs, 60_000), this.checker));
  }

  async cloze(term: string, translation: string): Promise<ClozeDraft[]> {
    return parseCloze(await this.ask(buildClozePrompt(term, translation), Math.max(this.opts.timeoutMs, 60_000), this.opts.model, [], false));
  }

  async drill(profile: string, count: number, avoid: string[] = []): Promise<DrillQuestion[]> {
    const timeout = Math.max(this.opts.timeoutMs, 60_000);
    const questions = parseDrill(await this.ask(buildDrillPrompt(profile, count, avoid), timeout));
    if (!questions.length) return [];
    return parseDrillReview(await this.ask(buildDrillReviewPrompt(questions), timeout, this.checker), questions);
  }

  /** Запоминалки — более сильной моделью (по умолчанию sonnet): придумывать ассоциации Haiku умеет плохо. */
  async mnemonics(items: MnemonicItem[]): Promise<string[]> {
    if (items.length === 0) return [];
    const raw = await this.ask(buildMnemonicPrompt(items), Math.max(this.opts.timeoutMs, 30_000 + items.length * 6_000), this.opts.mnemonicModel ?? "sonnet");
    return parseMnemonics(raw, items.length, items.map((w) => w.term));
  }

  /** Сцена для картинки — тоже сильной моделью: Haiku часто рисует случайную обстановку вместо смысла. */
  async imagePrompt(word: ImageSubject): Promise<string> {
    const raw = await this.ask(buildImagePromptPrompt(word), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet");
    return parseImagePrompt(raw);
  }

  async translationTask(input: TranslationInput): Promise<TranslationTask> {
    return parseTranslationTask(await this.ask(buildTranslationTaskPrompt(input), Math.max(this.opts.timeoutMs, 45_000)));
  }

  async reviewTranslation(input: { task: TranslationTask; answer: string }): Promise<TranslationReview> {
    return parseTranslationReview(await this.ask(buildTranslationReviewPrompt(input), Math.max(this.opts.timeoutMs, 60_000), this.checker));
  }

  /** Сочетания готовятся в фоне, так что можно сильной моделью: Haiku путает частые сочетания с возможными. */
  async collocations(term: string, translation: string): Promise<Collocations> {
    const timeout = Math.max(this.opts.timeoutMs, 60_000);
    const model = this.opts.mnemonicModel ?? "sonnet";
    const parsed = parseCollocations(await this.ask(buildCollocationsPrompt(term, translation), timeout, model, [], false));
    if (!parsed.quiz) return parsed;
    // Самопроверка: подставь каждый вариант и прочитай предложение (баг #20). Вопрос, где «верный»
    // вариант даёт бессмыслицу, отбрасываем — сочетания при этом остаются, они полезны сами по себе.
    try {
      const check = await this.checkCollocationQuiz({ term, translation, quiz: { term, ...parsed.quiz } });
      if (check.ok) return parsed;
      console.error("Collocation quiz rejected", term, check.why);
    } catch (err) {
      console.error("Collocation quiz check failed", term, err);
    }
    return { items: parsed.items };
  }

  async checkCollocationQuiz(input: { term: string; translation: string; quiz: QuizCheck }): Promise<{ ok: boolean; why: string }> {
    const timeout = Math.max(this.opts.timeoutMs, 60_000);
    const { term: _term, ...quiz } = input.quiz;
    return parseQuizCheck(await this.ask(buildQuizCheckPrompt({ term: input.term, ...quiz }, input.translation), timeout, this.checker, [], false));
  }

  /** Грамматика и родня слова — как и сочетания, в фоне и сильной моделью: часть речи и CEFR Haiku врёт. */
  async grammar(term: string, translation: string): Promise<WordGrammar> {
    return parseGrammar(await this.ask(buildGrammarPrompt(term, translation), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet", [], false));
  }

  /** Почему верен этот ответ — сильной моделью: объяснение правила Haiku упрощает до банальности. */
  async explainGrammar(input: { rule: string; task: string; answer: string }): Promise<string> {
    return parseExplainGrammar(await this.ask(buildExplainGrammarPrompt(input), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet"));
  }

  /** Естественные варианты — сильной моделью: Haiku склонен переводить дословно. */
  async say(phrase: string): Promise<SayAnswer> {
    return parseSayAnswer(await this.ask(dataNotInstructionsPrompt(buildSayPrompt(phrase)), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet"));
  }

  async talkReply(input: TalkInput): Promise<string> {
    return parseTalkReply(await this.ask(buildTalkReplyPrompt(input), Math.max(this.opts.timeoutMs, 45_000)));
  }

  /** Разбор разговора — сильной моделью: нужно заметить и ошибки, и неестественные фразы. */
  async talkReview(input: TalkInput): Promise<TalkReview> {
    return parseTalkReview(await this.ask(buildTalkReviewPrompt(input), Math.max(this.opts.timeoutMs, 90_000), this.opts.mnemonicModel ?? "sonnet"));
  }

  /** Разбор трудного слова — сильной моделью, как и запоминалки. */
  async untangle(word: { term: string; translation: string; explanation: string; example: string; mnemonic: string }): Promise<LeechHelp> {
    return parseLeechHelp(await this.ask(buildUntanglePrompt(word), Math.max(this.opts.timeoutMs, 60_000), this.opts.mnemonicModel ?? "sonnet", [], false));
  }

  /** История — сильной моделью: Haiku пишет скучно и натягивает слова. */
  async story(words: Array<{ term: string; translation: string }>): Promise<StoryDraft> {
    return parseStory(await this.ask(buildStoryPrompt(words), Math.max(this.opts.timeoutMs, 120_000), this.opts.mnemonicModel ?? "sonnet"));
  }

  async reviewSentence(input: SentenceInput): Promise<SentenceReview> {
    return parseSentenceReview(await this.ask(dataNotInstructionsPrompt(buildSentencePrompt(input)), Math.max(this.opts.timeoutMs, 60_000), this.checker));
  }

  async dialogueScene(input: DialogueInput): Promise<DialogueScene> {
    return parseDialogueScene(await this.ask(dataNotInstructionsPrompt(buildDialoguePrompt(input)), Math.max(this.opts.timeoutMs, 45_000), this.checker));
  }

  async judge(input: JudgeInput): Promise<Judgement> {
    return parseJudgement(await this.ask(dataNotInstructionsPrompt(buildJudgePrompt(input)), Math.max(this.opts.timeoutMs, 60_000), this.checker));
  }

  /** Один запрос к провайдеру без инструментов; возвращает текст ответа. */
  /** urgent — человек ждёт ответа; фоновые подготовки (предложения, сочетания, разборы) пропускают такие вперёд. */
  async ask(prompt: string, timeoutMs: number, model = this.opts.model, images: ImageInput[] = [], urgent = true): Promise<string> {
    // Таймаут отсчитывается с начала самого запроса, а не с постановки в очередь.
    return this.limiter.run(urgent, () => this.backend.ask(prompt, timeoutMs, model, images, EN));
  }
}
