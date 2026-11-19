import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { meetingPolls } from "../db/schema";
import { localParts } from "../time";

export async function getMeetingPoll(db: Db, chatId: number) {
  const [poll] = await db.select().from(meetingPolls).where(eq(meetingPolls.chatId, chatId));
  return poll;
}

export async function saveMeetingPoll(db: Db, chatId: number, settings: { time: string; timezone: string; options: string[] }) {
  await db.insert(meetingPolls).values({ chatId, ...settings })
    .onConflictDoUpdate({ target: meetingPolls.chatId, set: settings });
}

export async function disableMeetingPoll(db: Db, chatId: number) {
  await db.update(meetingPolls).set({ time: null }).where(eq(meetingPolls.chatId, chatId));
}

export async function sendMeetingPolls(
  db: Db,
  now: Date,
  send: (chatId: number, date: string, options: string[]) => Promise<unknown>,
) {
  const polls = await db.select().from(meetingPolls).where(isNotNull(meetingPolls.time));
  await Promise.all(polls.map(async ({ chatId, time, timezone, options, lastSentAt }) => {
    const local = localParts(timezone, now);
    if (!time || local.time < time || (lastSentAt && localParts(timezone, lastSentAt).date >= local.date)) return;
    try {
      await send(chatId, local.date, options);
      await db.update(meetingPolls).set({ lastSentAt: now }).where(eq(meetingPolls.chatId, chatId));
    } catch {
      console.warn("Meeting poll failed, will retry next tick", chatId);
    }
  }));
}
