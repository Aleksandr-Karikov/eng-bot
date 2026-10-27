import type { ImageInput } from "./enricher";
import type { LlmBackend } from "./backend";
import type { WordEnricher, Enrichment, ExtractedItem, CheckResult, ContextMessage } from "./enricher";
import type {
  ExerciseTutor,
  JudgeInput,
  Judgement,
  TranslationInput,
  TranslationTask,
  TranslationReview,
  Collocations,
  SayAnswer,
  TalkInput,
  TalkReview,
  LeechHelp,
  StoryDraft,
  SentenceInput,
  SentenceReview,
  DrillQuestion,
  MnemonicItem,
  ImageSubject,
} from "./tutor";
import type { ClozeDraft } from "../services/cloze";
import { ClaudeCodeEnricher } from "./claude-code";
import { modelsFor, OPENROUTER_MODEL_HINT, type ModelSets } from "./models";

export type Provider = "claude-code" | "openrouter";

export const PROVIDERS: Provider[] = ["claude-code", "openrouter"];

export function isProvider(value: unknown): value is Provider {
  return value === "claude-code" || value === "openrouter";
}

/**
 * Переключение провайдера на лету.
 *
 * Все 19 методов `WordEnricher` + `ExerciseTutor` — тонкие обёртки над одним запросом, вся содержательная
 * работа (сборка промптов и разбор ответов) общая. Поэтому вместо второго класса-дублёра здесь держатся
 * два готовых экземпляра — по одному на провайдера, с разными наборами моделей, — и переключение
 * сводится к замене ссылки. `Deps.enricher` уже интерфейсного типа, так что больше менять нечего,
 * и перезапуск не нужен: следующий же запрос уйдёт в нового провайдера.
 *
 * Незавершённые запросы при переключении не рвутся — они уже выполняются в том экземпляре, где начались.
 */
export class ProviderRouter implements WordEnricher, ExerciseTutor {
  private current: Provider;
  private readonly instances: Record<Provider, ClaudeCodeEnricher>;
  private readonly backends: { claudeCode?: LlmBackend; openrouter?: LlmBackend };
  /** Наборы моделей нужны и после сборки экземпляров: по пустому main видно, что OpenRouter не настроен. */
  private readonly models: ModelSets;

  /**
   * Куда сообщить о смене провайдера — сохранение выбора между запусками. Ставится сборкой зависимостей,
   * а не конструктором: тестам и CLI персистентность не нужна.
   */
  onSwitch?: (provider: Provider) => void;

  constructor(
    opts: {
      /** Модели обоих провайдеров; какие именно имена уйдут в запрос, решает modelsFor. */
      models: ModelSets;
      timeoutMs: number;
      /** Чем ходить в OpenRouter; не задан — провайдер недоступен для переключения. */
      openRouter?: LlmBackend;
      /** Чем ходить в Claude Code; по умолчанию — локальный Claude Code. */
      claudeCode?: LlmBackend;
      provider?: Provider;
    },
  ) {
    this.backends = { claudeCode: opts.claudeCode, openrouter: opts.openRouter };
    this.models = opts.models;
    const claudeModels = modelsFor("claude-code", opts.models);
    const openRouterModels = modelsFor("openrouter", opts.models);
    // checkModel здесь не отдельная сущность, а та же тройка: она и раньше означала «модель для проверок».
    this.instances = {
      "claude-code": new ClaudeCodeEnricher(
        { model: claudeModels.main, mnemonicModel: claudeModels.mnemonic, checkModel: claudeModels.check, timeoutMs: opts.timeoutMs },
        opts.claudeCode,
      ),
      openrouter: new ClaudeCodeEnricher(
        { model: openRouterModels.main, mnemonicModel: openRouterModels.mnemonic, checkModel: openRouterModels.check, timeoutMs: opts.timeoutMs },
        requireBackend(opts.openRouter),
      ),
    };
    this.current = opts.provider ?? "claude-code";
  }

  get provider(): Provider {
    return this.current;
  }

  /** Доступен ли OpenRouter: без ключа и без имени модели переключаться некуда. */
  get openRouterReady(): boolean {
    // Мало иметь ключ: без модели запрос уйдёт пустым и вернётся непонятной ошибкой от OpenRouter.
    return this.backends.openrouter !== undefined && this.models.openrouter.main !== "";
  }

  /**
   * Переключить провайдера. Возвращает прежнего — удобно для сообщения «было → стало».
   * Бросает, если OpenRouter не настроен: молча остаться на прежнем провайдере хуже, чем сказать вслух.
   */
  use(provider: Provider): Provider {
    if (provider === "openrouter" && !this.openRouterReady) {
      throw new Error(`OpenRouter не настроен: нужны OPEN_ROUTER_API_KEY и ${OPENROUTER_MODEL_HINT}`);
    }
    const previous = this.current;
    this.current = provider;
    if (previous !== provider) this.onSwitch?.(provider);
    return previous;
  }

  /** Переключиться, если получится; иначе вернуть причину — для команды в боте, которая не должна падать. */
  tryUse(provider: Provider): { ok: true; previous: Provider } | { ok: false; error: string } {
    try {
      return { ok: true, previous: this.use(provider) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private get active(): ClaudeCodeEnricher {
    return this.instances[this.current];
  }

  // Ниже — то же делегирование, что было бы унаследовано: каждый метод уходит в активный провайдер.
  // Список длинный намеренно: явные методы видны в типах и не дают молча потерять новый при добавлении.

  enrich(term: string, translationHint?: string, context?: string): Promise<Enrichment> {
    return this.active.enrich(term, translationHint, context);
  }
  enrichFast(term: string): Promise<Enrichment> {
    return this.active.enrichFast(term);
  }
  extract(text: string): Promise<ExtractedItem[]> {
    return this.active.extract(text);
  }
  extractImage(image: ImageInput, note?: string): Promise<ExtractedItem[]> {
    return this.active.extractImage(image, note);
  }
  readImage(image: ImageInput): Promise<string> {
    return this.active.readImage(image);
  }
  check(text: string, context?: ContextMessage[], author?: string, leadIn?: string[]): Promise<CheckResult> {
    return this.active.check(text, context, author, leadIn);
  }
  cloze(term: string, translation: string): Promise<ClozeDraft[]> {
    return this.active.cloze(term, translation);
  }
  judge(input: JudgeInput): Promise<Judgement> {
    return this.active.judge(input);
  }
  translationTask(input: TranslationInput): Promise<TranslationTask> {
    return this.active.translationTask(input);
  }
  reviewTranslation(input: { task: TranslationTask; answer: string }): Promise<TranslationReview> {
    return this.active.reviewTranslation(input);
  }
  collocations(term: string, translation: string): Promise<Collocations> {
    return this.active.collocations(term, translation);
  }
  say(phrase: string): Promise<SayAnswer> {
    return this.active.say(phrase);
  }
  talkReply(input: TalkInput): Promise<string> {
    return this.active.talkReply(input);
  }
  talkReview(input: TalkInput): Promise<TalkReview> {
    return this.active.talkReview(input);
  }
  untangle(word: { term: string; translation: string; explanation: string; example: string; mnemonic: string }): Promise<LeechHelp> {
    return this.active.untangle(word);
  }
  story(words: Array<{ term: string; translation: string }>): Promise<StoryDraft> {
    return this.active.story(words);
  }
  reviewSentence(input: SentenceInput): Promise<SentenceReview> {
    return this.active.reviewSentence(input);
  }
  drill(profile: string, count: number, avoid?: string[]): Promise<DrillQuestion[]> {
    return this.active.drill(profile, count, avoid);
  }
  mnemonics(items: MnemonicItem[]): Promise<string[]> {
    return this.active.mnemonics(items);
  }
  imagePrompt(word: ImageSubject): Promise<string> {
    return this.active.imagePrompt(word);
  }
}

/** Экземпляр для OpenRouter создаётся всегда — чтобы переключение не зависело от порядка настройки. */
function requireBackend(backend: LlmBackend | undefined): LlmBackend {
  return backend ?? new UnavailableBackend();
}

/** Заглушка: до неё доходят только если переключились без ключа, а это уже запрещено в use(). */
class UnavailableBackend implements LlmBackend {
  readonly name = "openrouter-unavailable";
  ask(): Promise<string> {
    return Promise.reject(new Error("OpenRouter не настроен"));
  }
}
