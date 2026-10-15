import { Bot } from "grammy";
import { BatchStore } from "../src/bot/batches";
import type { Update, UserFromGetMe } from "grammy/types";
import type { BotContext } from "../src/bot/context";
import { DraftStore } from "../src/bot/drafts";
import { setupBot } from "../src/bot/setup";
import type { CheckResult, Enrichment, ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { Notifier } from "../src/notifier";
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
    const result =
      method === "sendMessage"
        ? { message_id: calls.length, date: 0, chat: { id: call.payload.chat_id, type: "private" }, text: call.payload.text }
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
  setupBot(bot, { db, notifier, enricher, drafts: new DraftStore(), batches: new BatchStore(), now: () => T0, botUsername: BOT_INFO.username });

  let seq = 0;
  const from = (id: number) => ({ id, is_bot: false, first_name: `User${id}` });
  const chat = (id: number) => ({ id, type: "private" as const, first_name: `User${id}` });

  return {
    bot,
    db,
    calls,
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
