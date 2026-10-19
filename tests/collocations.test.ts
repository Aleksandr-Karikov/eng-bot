import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cardText } from "../src/bot/texts";
import { cards, reviewLogs, words } from "../src/db/schema";
import { parseCollocations, type Collocations, type ExerciseTutor } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord, updateWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const decision: Collocations = {
  items: [
    { phrase: "make a decision", translation: "принять решение" },
    { phrase: "a tough decision", translation: "трудное решение" },
  ],
  quiz: { question: "We need to ___ a decision soon.", options: ["do", "make", "take"], correct: 1, explanation: "decision — с make" },
};

async function setup(stored?: Collocations, practice = false) {
  const collocations = vi.fn(async () => decision);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story: async () => ({ title: "", body: "", questions: [] }),
    untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), talkReply: async () => "", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }),
    say: async () => ({ variants: [], learn: [] }), collocations, translationTask: async () => ({ ru: "Привет", en: "Hi", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }),
  };
  const h = botHarness({ tutor, random: () => 0.99 });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, modeRuEn: false, modeCloze: false, modeSentence: false, modeListen: false, modeEnRu: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "decision", translation: "решение", explanation: "", example: "" }, now: T0 });
  if (stored) await h.db.update(words).set({ collocations: JSON.stringify(stored) });
  await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due: new Date(T0.getTime() + (practice ? 5 : -1) * DAY) });
  return { h, collocations, user };
}

const texts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));
const logs = async (h: ReturnType<typeof botHarness>) => (await h.db.select().from(reviewLogs)).map((l) => `${l.stage}:${l.rating}`);

describe("🔗 collocations", () => {
  it("keeps the list even if the quiz is broken", () => {
    const parsed = parseCollocations(JSON.stringify({ items: decision.items, quiz: { question: "no gap", options: ["a"], correct: 5 } }));
    expect(parsed).toEqual({ items: decision.items, quiz: undefined });
  });

  it("are shown on the card under the spoiler", () => {
    const text = cardText({ term: "decision", translation: "решение", explanation: "", example: "", collocations: JSON.stringify(decision) });
    expect(text).toMatch(/<tg-spoiler>[^]*🔗 make a decision · a tough decision[^]*<\/tg-spoiler>/);
  });

  it("asks which partner fits, rates the card and shows all collocations", async () => {
    const { h } = await setup(decision);
    // random 0.99 — последний из доступных, то есть сочетания.
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(texts(h).at(-1)).toContain("Какое слово подходит к <b>decision</b>");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "make")));
    expect(texts(h).find((t) => t.startsWith("✅ Верно"))).toContain("🔗 <b>Сочетания:</b>");
    expect(await logs(h)).toEqual(["collocation:good"]);
  });

  it("without a ready quiz shows a regular card and prepares collocations once", async () => {
    const { h, collocations } = await setup();
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(texts(h).at(-1)).toContain("Вспомни перевод");
    await vi.waitFor(async () => expect((await h.db.select().from(words))[0].collocations).not.toBe(""));
    expect(collocations).toHaveBeenCalledTimes(1);
    await updateWord(h.db, 1, { term: "decision", translation: "вывод", explanation: "", example: "" });
    expect((await h.db.select().from(words).where(eq(words.id, 1)))[0].collocations).toBe("");
  });

  it("in practice outside the schedule only explains", async () => {
    const { h } = await setup(decision, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "do")));
    expect(texts(h).some((t) => t.startsWith("❌ Не «do»"))).toBe(true);
    expect(await logs(h)).toEqual([]);
  });
});

describe("model answers with second thoughts", () => {
  it("takes the last whole JSON object", () => {
    const twice = `${JSON.stringify({ items: [] })}\nПодождите — исправляю:\n${JSON.stringify(decision)}`;
    expect(parseCollocations(twice)).toEqual(decision);
  });
});
