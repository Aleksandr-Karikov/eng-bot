import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms, words, type Room } from "../db/schema";
import { localParts } from "../time";
import { listMembers } from "./rooms";
import { personalStats, roomLeaderboard } from "./stats";

/** Дайджест — по воскресеньям в 20:00 по Новосибирску. */
const DIGEST_TZ = "Asia/Novosibirsk";
const DIGEST_WEEKDAY = "Sun";
const DIGEST_TIME = "20:00";
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Локальная дата дайджеста, если пора его отправить, иначе null. */
export function digestDue(room: { lastDigestDate: string | null }, now: Date): string | null {
  const { date, time } = localParts(DIGEST_TZ, now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: DIGEST_TZ, weekday: "short" }).format(now);
  if (weekday !== DIGEST_WEEKDAY || time < DIGEST_TIME || room.lastDigestDate === date) return null;
  return date;
}

export interface DigestRow {
  userId: number;
  name: string;
  /** Слов добавлено в комнату за неделю. */
  added: number;
  reviews7d: number;
  learned: number;
  streak: number;
}

export async function weeklyDigest(db: Db, roomId: number, now: Date): Promise<DigestRow[]> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const board = await roomLeaderboard(db, roomId, now);
  const recentWords = await db
    .select({ addedBy: words.addedBy })
    .from(words)
    .where(and(eq(words.roomId, roomId), gte(words.createdAt, weekAgo)));
  const members = await listMembers(db, roomId);
  const rows: DigestRow[] = [];
  for (const member of members) {
    const row = board.find((r) => r.userId === member.id);
    rows.push({
      userId: member.id,
      name: member.firstName,
      added: recentWords.filter((w) => w.addedBy === member.id).length,
      reviews7d: row?.reviews7d ?? 0,
      learned: row?.learned ?? 0,
      streak: (await personalStats(db, member, now)).streak,
    });
  }
  return rows.sort((a, b) => b.reviews7d - a.reviews7d || b.added - a.added);
}

/** Комнаты, которым пора отправить дайджест; помечает их, а пустые недели (без активности) пропускает. */
export async function collectDigests(db: Db, now: Date): Promise<Array<{ room: Room; rows: DigestRow[] }>> {
  const result: Array<{ room: Room; rows: DigestRow[] }> = [];
  for (const room of await db.select().from(rooms)) {
    const date = digestDue(room, now);
    if (!date) continue;
    await db.update(rooms).set({ lastDigestDate: date }).where(eq(rooms.id, room.id));
    const rows = await weeklyDigest(db, room.id, now);
    if (rows.some((r) => r.added > 0 || r.reviews7d > 0)) result.push({ room, rows });
  }
  return result;
}
