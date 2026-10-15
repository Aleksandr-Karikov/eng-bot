import type { Context } from "grammy";
import type { Db } from "../db/client";
import type { Room, User } from "../db/schema";
import type { WordEnricher } from "../llm/enricher";
import type { Notifier } from "../notifier";
import type { BatchStore } from "./batches";
import type { DraftStore } from "./drafts";
import type { PickerStore } from "./pickers";

export type BotContext = Context & { user: User };

export interface Deps {
  db: Db;
  enricher: WordEnricher;
  notifier: Notifier;
  drafts: DraftStore;
  batches: BatchStore;
  pickers: PickerStore;
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
