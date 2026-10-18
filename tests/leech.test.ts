import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs, words } from "../src/db/schema";
import type { ExerciseTutor, LeechHelp } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord, updateWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const help: LeechHelp = {
  why: "Похоже на prudish",
  contrast: ["prudish — ханжеский"],
  examples: ["It's **prudent** to save money — разумно копить"],
  tip: "prudent ≈ provident",
};

async function setup(forgotBefore: number) {
  const untangle = vi.fn(async () => help);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story: async () => ({ title: "", body: "", questions: [] }), untangle, say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }),
  };
  const h = botHarness({ tutor });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, modeRuEn: false, modeCloze: false, modeSentence: false, modeListen: false });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of ["prudent", "bank"]) {
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
  }
  await h.db.update(cards).set({ state: 2, stability: 1, reps: 5, due: new Date(T0.getTime() - DAY) });
  await h.db.update(cards).set({ due: new Date(T0.getTime() - 2 * DAY) }).where(eq(cards.wordId, 1));
  for (let i = 0; i < forgotBefore; i++) await h.db.insert(reviewLogs).values({ userId: user.id, cardId: 1, rating: "again", reviewedAt: T0 });
  return { h, untangle };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("🧩 hard words", () => {
  it("on the 4th «Забыл» explains the word, then sends the next card below it", async () => {
    const { h, untangle } = await setup(3);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(sent(h).at(-1)).toContain("prudent");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😵 Забыл")));
    const texts = sent(h);
    const leech = texts.findIndex((t) => t.startsWith("🧩"));
    expect(texts[leech]).toContain("забыто уже 4 раза");
    expect(texts[leech]).toContain("prudish — ханжеский");
    expect(texts[leech]).toContain("<b>prudent</b> to save money");
    expect(texts[leech + 1]).toContain("bank");
    expect(untangle).toHaveBeenCalledTimes(1);
  });

  it("prepares the explanation in advance on the 3rd and keeps it for the room until the word changes", async () => {
    const { h, untangle } = await setup(2);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😵 Забыл")));
    expect(sent(h).some((t) => t.startsWith("🧩"))).toBe(false);
    await vi.waitFor(async () => expect((await h.db.select().from(words).where(eq(words.id, 1)))[0].leechHelp).not.toBe(""));
    expect(untangle).toHaveBeenCalledTimes(1);
    await updateWord(h.db, 1, { term: "prudent", translation: "осторожный", explanation: "", example: "" });
    expect((await h.db.select().from(words).where(eq(words.id, 1)))[0].leechHelp).toBe("");
  });

  it("stays quiet on remembered answers", async () => {
    const { h, untangle } = await setup(3);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😎 Помню")));
    expect(sent(h).some((t) => t.startsWith("🧩"))).toBe(false);
    expect(untangle).not.toHaveBeenCalled();
  });
});
