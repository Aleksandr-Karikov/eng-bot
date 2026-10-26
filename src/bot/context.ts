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

/** groupRoom — комната привязанной группы (в группах; null — группа не привязана), её находит userMiddleware. */
export type BotContext = Context & {
  user: User;
  groupRoom?: Room | null;
  /** Короткий итог прошлого ответа («✅ Верно: …») — встанет шапкой следующего задания (см. present), а не отдельным сообщением. */
  lead?: string;
};

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
  practice: PracticeStore;
  pictureWishes: PictureWishStore;
  talks: TalkStore;
  translations: TranslateStore;
  /** Публичный адрес Mini App (APP_URL); нет — кнопки «Учить» нет. */
  appUrl?: string;
  /** Кому слать новые /bug (ADMIN_TELEGRAM_ID); нет — никому. */
  adminTelegramId?: number;
  /** Недавняя переписка чатов — контекст для /bug. */
  transcript: ChatTranscript;
  /** Порт локального приёма слов из расширения. */
  capturePort?: number;
  /** Частотность слов для оценки полезности; undefined — оценивает только модель. */
  frequency?: FrequencySource;
  /** Субтитры YouTube для /text со ссылкой; undefined — yt-dlp не установлен. */
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
