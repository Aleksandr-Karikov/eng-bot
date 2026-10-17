import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { User } from "../src/db/schema";
import { cards, words } from "../src/db/schema";
import { wordOfDayText } from "../src/bot/texts";
import { sendWordsOfDay } from "../src/reminder-loop";
import { collectWordsOfDay, wordOfDayDue } from "../src/services/word-of-day";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { DAY, makeUser, testDb } from "./helpers";

const nsk = (iso: string) => new Date(`${iso}+07:00`);

async function setup(telegramChatId?: number) {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: nsk("2026-10-01T10:00"), telegramChatId });
  const ids: Record<string, number> = {};
  for (const [term, stability] of [["easy", 30], ["hard", 0.5], ["medium", 5]] as const) {
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: nsk("2026-10-01T10:00") });
    if (r.status !== "saved") throw new Error("dup");
    ids[term] = r.word.id;
    await db.update(cards).set({ state: 2, stability }).where(eq(cards.wordId, r.word.id));
  }
  return { db, room, ids };
}

describe("word of the day", () => {
  it("is due from 10:00 Novosibirsk, once a day", () => {
    expect(wordOfDayDue({ lastWordOfDayDate: null }, nsk("2026-10-17T09:59"))).toBeNull();
    expect(wordOfDayDue({ lastWordOfDayDate: null }, nsk("2026-10-17T10:00"))).toBe("2026-10-17");
    expect(wordOfDayDue({ lastWordOfDayDate: "2026-10-17" }, nsk("2026-10-17T15:00"))).toBeNull();
  });

  it("picks the weakest word for the room and does not repeat it within 30 days", async () => {
    const { db } = await setup(-900);
    const day1 = await collectWordsOfDay(db, nsk("2026-10-17T10:00"));
    expect(day1.map((w) => w.word.term)).toEqual(["hard"]);
    expect(await collectWordsOfDay(db, nsk("2026-10-17T11:00"))).toEqual([]);
    const day2 = await collectWordsOfDay(db, nsk("2026-10-18T10:00"));
    expect(day2.map((w) => w.word.term)).toEqual(["medium"]);
    const [hard] = await db.select().from(words).where(eq(words.term, "hard"));
    expect(hard.featuredAt?.getTime()).toBe(nsk("2026-10-17T10:00").getTime());
    void DAY;
  });

  it("only goes to rooms with a linked group", async () => {
    const { db } = await setup();
    expect(await collectWordsOfDay(db, nsk("2026-10-17T10:00"))).toEqual([]);
  });

  it("posts to the group with the translation under a spoiler and pronunciation buttons", async () => {
    const { db } = await setup(-900);
    const posts: Array<{ chatId: number; text: string; other?: Record<string, unknown> }> = [];
    const notifier = {
      dm: async (_u: User) => true,
      group: async (chatId: number, text: string, other?: Record<string, unknown>) => (posts.push({ chatId, text, other }), true),
    };
    await sendWordsOfDay({ db, notifier, now: () => nsk("2026-10-17T10:00") });
    expect(posts).toHaveLength(1);
    expect(posts[0].chatId).toBe(-900);
    expect(posts[0].text).toContain("<tg-spoiler>t-hard</tg-spoiler>");
    expect(JSON.stringify(posts[0].other)).toContain("🔊 UK");
  });

  it("formats the text", () => {
    const text = wordOfDayText({ term: "R&D", translation: "НИОКР", explanation: "", example: "We invest in R&D.", transcriptionUk: "/ɑːr ən ˈdiː/" });
    expect(text).toContain("Слово дня");
    expect(text).toContain("<b>R&amp;D</b>");
    expect(text).toContain("<tg-spoiler>НИОКР</tg-spoiler>");
  });
});
