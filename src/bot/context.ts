import type { Context } from "grammy";
import type { Db } from "../db/client";
import type { Room, User } from "../db/schema";
import type { WordEnricher } from "../llm/enricher";
import type { Notifier } from "../notifier";
import type { DraftStore } from "./drafts";

export type BotContext = Context & { user: User };

export interface Deps {
  db: Db;
  enricher: WordEnricher;
  notifier: Notifier;
  drafts: DraftStore;
  now: () => Date;
  botUsername: string;
}

export const HTML = { parse_mode: "HTML" } as const;

export function inviteLink(botUsername: string, room: Room): string {
  return `https://t.me/${botUsername}?start=join_${room.inviteCode}`;
}
