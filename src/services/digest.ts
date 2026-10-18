import { wordUsesSince } from "./word-uses";
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms, words, type Room } from "../db/schema";
import { localParts, previousDate } from "../time";
import { weeklyDuelPoints, type DuelScore } from "./duels";
import { listMembers } from "./rooms";
import { personalStats, roomLeaderboard } from "./stats";

/** Дайджест — по воскресеньям в 20:00 по Новосибирску. */
const DIGEST_TZ = "Asia/Novosibirsk";
const DIGEST_TIME = "20:00";
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** В Новосибирске нет перехода на летнее время — смещение постоянное. */
const DIGEST_UTC_OFFSET = "+07:00";
/** Если бот не работал в воскресенье вечером, дайджест догоняет в течение двух суток. */
const CATCH_UP_MS = 48 * 60 * 60_000;

/** Последний момент «воскресенье 20:00» по поясу дайджеста, не позже now. */
function latestDigestMoment(now: Date): { date: string; at: Date } {
  let day = localParts(DIGEST_TZ, now).date;
  for (let i = 0; i < 14; i++, day = previousDate(day)) {
    if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 0) continue;
    const at = new Date(`${day}T${DIGEST_TIME}:00${DIGEST_UTC_OFFSET}`);
    if (at.getTime() <= now.getTime()) return { date: day, at };
  }
  throw new Error("unreachable: a Sunday within two weeks");
}

/** Дата (воскресенье) дайджеста, который пора отправить, иначе null. */
export function digestDue(room: { lastDigestDate: string | null }, now: Date): string | null {
  const due = latestDigestMoment(now);
  if (now.getTime() - due.at.getTime() > CATCH_UP_MS) return null;
  if ((room.lastDigestDate ?? "") >= due.date) return null;
  return due.date;
}

export interface DigestRow {
  userId: number;
  name: string;
  /** Слов добавлено в комнату за неделю. */
  added: number;
  reviews7d: number;
  learned: number;
  streak: number;
  /** Слов комнаты, употреблённых в разговоре в группе. */
  used: number;
}

export async function weeklyDigest(db: Db, roomId: number, now: Date): Promise<DigestRow[]> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const board = await roomLeaderboard(db, roomId, now);
  const recentWords = await db
    .select({ addedBy: words.addedBy })
    .from(words)
    .where(and(eq(words.roomId, roomId), gte(words.createdAt, weekAgo)));
  const members = await listMembers(db, roomId);
  const uses = await wordUsesSince(db, roomId, weekAgo);
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
      used: uses.get(member.id) ?? 0,
    });
  }
  return rows.sort((a, b) => b.reviews7d - a.reviews7d || b.added - a.added);
}

/** Комнаты, которым пора отправить дайджест; помечает их, а пустые недели (без активности) пропускает. */
export async function collectDigests(
  db: Db,
  now: Date,
): Promise<Array<{ room: Room; rows: DigestRow[]; duels: DuelScore[] }>> {
  const result: Array<{ room: Room; rows: DigestRow[]; duels: DuelScore[] }> = [];
  for (const room of await db.select().from(rooms)) {
    const date = digestDue(room, now);
    if (!date) continue;
    await db.update(rooms).set({ lastDigestDate: date }).where(eq(rooms.id, room.id));
    const rows = await weeklyDigest(db, room.id, now);
    const duels = await weeklyDuelPoints(db, room.id, now);
    if (rows.some((r) => r.added > 0 || r.reviews7d > 0 || r.used > 0) || duels.length) result.push({ room, rows, duels });
  }
  return result;
}
