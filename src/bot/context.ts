import type { Context } from "grammy";
import type { Db } from "../db/client";
import type { Room, User } from "../db/schema";
import type { ImageService } from "../images/images";
import type { PictureStore } from "../images/store";
import type { WordEnricher } from "../llm/enricher";
import type { ExerciseTutor } from "../llm/tutor";
import type { ClozeGenerator } from "../services/cloze-generator";
import type { MnemonicGenerator } from "../services/hard-words";
import type { SpeechSynth } from "../speech/tts";
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
import type { RoomNameStore } from "./room-names";

export type BotContext = Context & { user: User };

export interface Deps {
  db: Db;
  enricher: WordEnricher;
  tutor: ExerciseTutor;
  clozeGen: ClozeGenerator;
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
  voices: VoiceStore;
  roomNames: RoomNameStore;
  duels: DuelStore;
  pendingMistakes: PendingMistakesStore;
  /** Случайность выбора упражнения (Math.random; в тестах — подменяется). */
  random: () => number;
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
