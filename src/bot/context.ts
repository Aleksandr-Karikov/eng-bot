import type { Context } from "grammy";
import type { Db } from "../db/client";
import type { Room, User } from "../db/schema";
import type { ImageService } from "../images/images";
import type { PictureStore } from "../images/store";
import type { WordEnricher } from "../llm/enricher";
import type { ExerciseTutor } from "../llm/tutor";
import type { ClozeGenerator } from "../services/cloze-generator";
import type { CollocationGenerator } from "../services/collocations";
import type { MnemonicGenerator } from "../services/hard-words";
import type { SpeechSynth } from "../speech/tts";
import type { SpeechRecognizer } from "../speech/stt";
import type { VoiceStore } from "./voices";
import type { Notifier } from "../notifier";
import type { BatchStore } from "./batches";
import type { DraftStore } from "./drafts";
import type { DuelStore } from "./duels";
import type { DrillStore } from "./drills";
import type { EditStore } from "./edits";
import type { ExerciseStore } from "./exercises";
import type { ChatHistory } from "./history";
import type { PendingMistakesStore } from "./pending-mistakes";
import type { PickerStore } from "./pickers";
import type { PictureWishStore } from "./picture-wishes";
import type { PracticeStore } from "./practice";
import type { RoomNameStore } from "./room-names";
import type { TalkStore } from "./talks";
import type { ChatTranscript } from "./transcript";
import type { FrequencySource } from "../frequency/frequency";
import type { TranslateStore } from "./translations";
import type { SubtitleSource } from "../youtube/subtitles";

/** Что боту нужно знать про LLM-провайдера, чтобы им можно было управлять из чата (см. `src/llm/provider.ts`). */
export interface LlmSwitch {
  /** Имя активного провайдера. */
  readonly provider: string;
  /** Доступен ли второй провайдер; нет — переключаться некуда. */
  readonly openRouterReady: boolean;
  /** Переключить, вернув прежнего; ошибка — если провайдер не настроен. */
  use(provider: "claude-code" | "openrouter"): string;
}

/** groupRoom — комната привязанной группы (в группах; null — группа не привязана), её находит userMiddleware. */
export type BotContext = Context & {
  user: User;
  groupRoom?: Room | null;
  /** Короткий итог прошлого ответа («✅ Верно: …») — встанет шапкой следующего задания (см. present), а не отдельным сообщением. */
  lead?: string;
};

/**
 * Чем бот работает прямо сейчас — для команды админа /status.
 *
 * Собрано намеренно «плоско» и без `Config`: в `Config` лежат ключи, и достаточно одного неаккуратного
 * `console.log(config)` или нового поля, чтобы они уехали в чат. Здесь только то, что можно показывать,
 * и всё это известно в `src/index.ts` в момент сборки.
 */
export interface BotStatus {
  /** Когда процесс стартовал: по этому видно, подхватились ли правки без перезапуска. */
  startedAt: Date;
  /** Провайдер LLM и доступность второго (см. LlmSwitch). */
  llm: LlmSwitch;
  /** Имена моделей по назначению; пусто — не задано. */
  models: { main: string; mnemonic: string; check: string };
  /** Чем рисуются картинки; "off" — картинки выключены целиком. */
  images: { synth: "api" | "flux" | "off"; model?: string; background: boolean; style: string };
  /** Заданы ли ключи — сами значения не показываем никогда, только факт. */
  secrets: { openRouter: boolean; imageApi: boolean };
  /** Что установлено из инструментов: нет venv — нет и умения. */
  tools: { tts: string; stt: boolean; youtube: boolean; frequency: boolean };
  /** Внешние поверхности: без APP_URL кнопки «Учить» нет, без ADMIN_TELEGRAM_ID нет /bug админу. */
  app: { port?: number; urlSet: boolean; capturePort?: number };
}

export interface Deps {
  db: Db;
  enricher: WordEnricher;
  tutor: ExerciseTutor;
  clozeGen: ClozeGenerator;
  collocationGen: CollocationGenerator;
  mnemonicGen: MnemonicGenerator;
  notifier: Notifier;
  drafts: DraftStore;
  batches: BatchStore;
  pickers: PickerStore;
  edits: EditStore;
  history: ChatHistory;
  exercises: ExerciseStore;
  drills: DrillStore;
  speech: SpeechSynth;
  /** Распознавание голосовых; undefined — не установлено (tools/stt). */
  recognizer?: SpeechRecognizer;
  /** Приветственное видео для /start (assets/welcome.mp4, собирается tools/video/build.sh); undefined — без видео. */
  welcomeVideo?: string;
  /** Куда складывать голосовые из /pron с результатами — для оценки, можно ли верить проверке. */
  voiceSamplesDir?: string;
  voices: VoiceStore;
  roomNames: RoomNameStore;
  duels: DuelStore;
  pendingMistakes: PendingMistakesStore;
  /** Случайность выбора упражнения (Math.random; в тестах — подменяется). */
  random: () => number;
  /** Дополнительно к `enricher`/`tutor`: смена LLM-провайдера на лету и его текущее имя (нет — только Claude Code). */
  llm?: LlmSwitch;
  practice: PracticeStore;
  pictureWishes: PictureWishStore;
  talks: TalkStore;
  translations: TranslateStore;
  /** Публичный адрес Mini App (APP_URL); нет — кнопки «Учить» нет. */
  appUrl?: string;
  /** Кому слать новые /bug (ADMIN_TELEGRAM_ID); нет — никому. */
  adminTelegramId?: number;
  /** Чем бот работает сейчас — для /status (только админ). Нет — команда скажет, что не собрана. */
  status?: BotStatus;
  /** Недавняя переписка чатов — контекст для /bug. */
  transcript: ChatTranscript;
  /** Порт локального приёма слов из расширения. */
  capturePort?: number;
  /** Частотность слов для оценки полезности; undefined — оценивает только модель. */
  frequency?: FrequencySource;
  /** Субтитры YouTube для /text со ссылкой; undefined — нет tools/youtube/.venv (YOUTUBE_PYTHON). */
  youtube?: SubtitleSource;
  /** Картинки-ассоциации; undefined — выключены (IMAGES_ENABLED). */
  images?: ImageService;
  /** Картинки, нарисованные заранее в фоне, — до первой отправки. */
  pictures?: PictureStore;
  now: () => Date;
  botUsername: string;
}

export const HTML = { parse_mode: "HTML" } as const;

export function inviteLink(botUsername: string, room: Room): string {
  return `https://t.me/${botUsername}?start=join_${room.inviteCode}`;
}

/** Запускает долгую работу (LLM, рассылки) вне обработки update, чтобы бот не замирал для остальных. */
export function background(ctx: BotContext, task: () => Promise<void>): void {
  task().catch(async (err) => {
    console.error("Background task failed", err);
    await ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
