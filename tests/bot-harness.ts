import { Bot } from "grammy";
import { BatchStore } from "../src/bot/batches";
import { ChatHistory } from "../src/bot/history";
import { PendingMistakesStore } from "../src/bot/pending-mistakes";
import { PickerStore } from "../src/bot/pickers";
import { PracticeStore } from "../src/bot/practice";
import { RoomNameStore } from "../src/bot/room-names";
import type { Update, UserFromGetMe } from "grammy/types";
import type { BotContext } from "../src/bot/context";
import { DraftStore } from "../src/bot/drafts";
import { DrillStore } from "../src/bot/drills";
import { DuelStore } from "../src/bot/duels";
import { EditStore } from "../src/bot/edits";
import { ExerciseStore } from "../src/bot/exercises";
import { setupBot } from "../src/bot/setup";
import type { CheckResult, Enrichment, ExtractedItem, WordEnricher } from "../src/llm/enricher";
import type { ExerciseTutor } from "../src/llm/tutor";
import type { SpeechSynth } from "../src/speech/tts";
import { ImageService, type ImageSynth } from "../src/images/images";
import { PictureStore } from "../src/images/store";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceStore } from "../src/bot/voices";
import { Notifier } from "../src/notifier";
import { ClozeGenerator } from "../src/services/cloze-generator";
import { MnemonicGenerator } from "../src/services/hard-words";
import { T0, testDb } from "./helpers";

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

const BOT_INFO = {
  id: 999,
  is_bot: true,
  first_name: "Bot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
} as UserFromGetMe;

/** Настоящие обработчики бота поверх фейкового Telegram API. */
export function botHarness(opts: {
  enricher?: WordEnricher;
  tutor?: ExerciseTutor;
  speech?: SpeechSynth;
  /** Время на раунд дуэли (мс). */
  duelRoundMs?: number;
  /** Случайность выбора упражнения (по умолчанию 0 — первый из доступных, т.е. EN → RU). */
  random?: () => number;
  /** Рисовалка картинок; не задана — картинки выключены. */
  images?: ImageSynth;
  /** Папка с картинками на диске (по умолчанию — временная, если картинки включены). */
  pictures?: PictureStore;
  /** Вернуть описание ошибки, чтобы Telegram ответил на вызов `ok: false` (error_code 400). */
  fail?: (call: ApiCall) => string | undefined;
} = {}) {
  const db = testDb();
  const calls: ApiCall[] = [];
  const bot = new Bot<BotContext>("test-token", { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    const call = { method, payload: payload as Record<string, unknown> };
    calls.push(call);
    const description = opts.fail?.(call);
    if (description) return { ok: false, error_code: 400, description } as never;
    const message = { message_id: calls.length, date: 0, chat: { id: call.payload.chat_id, type: "private" } };
    const result =
      method === "sendMessage"
        ? { ...message, text: call.payload.text }
        : method === "sendVoice"
          ? { ...message, voice: { file_id: `voice-file-${calls.length}`, file_unique_id: "u", duration: 1 } }
          : method === "sendPhoto"
            ? { ...message, photo: [{ file_id: `photo-small-${calls.length}` }, { file_id: `photo-file-${calls.length}` }] }
            : true;
    return { ok: true, result } as never;
  });
  const notifier = new Notifier(
    { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as never) },
    db,
  );
  const enricher: WordEnricher = opts.enricher ?? {
    enrich: async (): Promise<Enrichment> => ({ translation: "перевод", explanation: "", example: "" }),
    extract: async (): Promise<ExtractedItem[]> => [],
    check: async (): Promise<CheckResult> => ({ corrected: "", fixes: [], natural: "" }),
  };
  const tutor: ExerciseTutor = opts.tutor ?? {
    cloze: async () => [1, 2, 3].map((i) => ({ sentence: `Sentence ${i} with ___.`, answer: "x", translation: `Перевод ${i}` })),
    judge: async () => ({ correct: false, explanation: "", tip: "" }),
    drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
  };
  const clozeGen = new ClozeGenerator(db, tutor, () => T0);
  const pictures = opts.pictures ?? (opts.images ? new PictureStore(mkdtempSync(join(tmpdir(), "pictures-"))) : undefined);
  const speech: SpeechSynth = opts.speech ?? { synthesize: async () => Buffer.from("ogg") };
  setupBot(bot, { db, notifier, enricher, tutor, clozeGen, mnemonicGen: new MnemonicGenerator(db, tutor), drafts: new DraftStore(), batches: new BatchStore(), pickers: new PickerStore(), edits: new EditStore(), history: new ChatHistory(), exercises: new ExerciseStore(), drills: new DrillStore(), speech, voices: new VoiceStore(), roomNames: new RoomNameStore(), duels: new DuelStore(opts.duelRoundMs ?? 30_000), pendingMistakes: new PendingMistakesStore(), random: opts.random ?? (() => 0), practice: new PracticeStore(), images: opts.images ? new ImageService(opts.images, tutor) : undefined, pictures, now: () => T0, botUsername: BOT_INFO.username });

  let seq = 0;
  const from = (id: number) => ({ id, is_bot: false, first_name: `User${id}` });
  const chat = (id: number) => ({ id, type: "private" as const, first_name: `User${id}` });

  return {
    bot,
    db,
    calls,
    clozeGen,
    pictures,
    message(userId: number, text: string): Update {
      seq++;
      const command = text.startsWith("/") ? text.split(" ")[0] : undefined;
      return {
        update_id: seq,
        message: {
          message_id: seq,
          date: 0,
          chat: chat(userId),
          from: from(userId),
          text,
          entities: command ? [{ type: "bot_command", offset: 0, length: command.length }] : undefined,
        },
      } as Update;
    },
    /** Сообщение в группе chatId; replyToBot — ответ на сообщение бота. */
    groupMessage(userId: number, chatId: number, text: string, replyToBot = false): Update {
      seq++;
      const group = { id: chatId, type: "group" as const, title: "Group" };
      const command = text.startsWith("/") ? text.split(" ")[0] : undefined;
      return {
        update_id: seq,
        message: {
          message_id: seq,
          date: 0,
          chat: group,
          from: from(userId),
          text,
          entities: command ? [{ type: "bot_command", offset: 0, length: command.length }] : undefined,
          reply_to_message: replyToBot
            ? { message_id: 1, date: 0, chat: group, from: { id: BOT_INFO.id, is_bot: true, first_name: "Bot" }, text: "prompt" }
            : undefined,
        },
      } as Update;
    },
    /** Сообщение в группе ответом на сообщение original. */
    groupReplyTo(userId: number, chatId: number, text: string, original: { messageId: number; fromId: number; text: string }): Update {
      const update = this.groupMessage(userId, chatId, text);
      update.message!.reply_to_message = {
        message_id: original.messageId,
        date: 0,
        chat: update.message!.chat,
        from: from(original.fromId),
        text: original.text,
      } as never;
      return update;
    },
    /** Команда `text` от userId ответом на сообщение `original` другого участника. */
    replyTo(userId: number, text: string, original: { messageId: number; fromId: number; text: string }): Update {
      const update = this.message(userId, text);
      update.message!.reply_to_message = {
        message_id: original.messageId,
        date: 0,
        chat: chat(userId),
        from: from(original.fromId),
        text: original.text,
      } as never;
      return update;
    },
    /** Нажатие кнопки в группе chatId. */
    groupCallback(userId: number, chatId: number, data: string): Update {
      seq++;
      return {
        update_id: seq,
        callback_query: {
          id: `cq${seq}`,
          from: from(userId),
          chat_instance: "ci",
          data,
          message: { message_id: 1, date: 0, chat: { id: chatId, type: "group", title: "Group" }, text: "old" },
        },
      } as Update;
    },
    callback(userId: number, data: string): Update {
      seq++;
      return {
        update_id: seq,
        callback_query: {
          id: `cq${seq}`,
          from: from(userId),
          chat_instance: "ci",
          data,
          message: { message_id: 1, date: 0, chat: chat(userId), text: "old" },
        },
      } as Update;
    },
  };
}

export const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Button = { text: string; callback_data: string };

/** Кнопки последнего сообщения/редактирования с inline-клавиатурой. */
export function lastButtons(calls: ApiCall[]): Button[] {
  const call = [...calls].reverse().find((c) => {
    const markup = c.payload.reply_markup as { inline_keyboard?: unknown } | undefined;
    return markup?.inline_keyboard !== undefined;
  });
  return call ? (call.payload.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard.flat() : [];
}

/** callback_data самой свежей кнопки, чей текст начинается с prefix. */
export function buttonData(calls: ApiCall[], prefix: string): string {
  const found = [...calls]
    .reverse()
    .flatMap((c) => (c.payload.reply_markup as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard?.flat() ?? [])
    .find((b) => b.text.startsWith(prefix));
  if (!found) throw new Error(`No button "${prefix}" in ${JSON.stringify(lastButtons(calls).map((b) => b.text))}`);
  return found.callback_data;
}
