import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, mistakes, reviewLogs } from "../src/db/schema";
import type { ExerciseTutor, SentenceReview } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const review = (over: Partial<SentenceReview> = {}): SentenceReview => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "", ...over });

function tutor(reviewSentence: ExerciseTutor["reviewSentence"]): ExerciseTutor {
  return { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "", reviewSentence };
}

/** Одна знакомая карточка (bank) к повторению, включён только один режим. */
async function setup(h: ReturnType<typeof botHarness>, only: "modeSentence" | "modeListen", practice = false) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, {
    canDm: true,
    modeEnRu: false,
    modeRuEn: false,
    modeCloze: false,
    modeSentence: only === "modeSentence",
    modeListen: only === "modeListen",
  });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "We sat on the river bank." }, now: T0 });
  const due = new Date(T0.getTime() + (practice ? 5 * DAY : -DAY));
  await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due });
  return user;
}

const texts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));
const logs = async (h: ReturnType<typeof botHarness>) => (await h.db.select().from(reviewLogs)).map((l) => `${l.stage}:${l.rating}`);

describe("✍️ own sentence", () => {
  it("asks for a sentence, rates by whether the word is used right and offers to save the other mistakes", async () => {
    const reviewSentence = vi.fn(async () =>
      review({ verdict: "bank — берег реки, всё верно", corrected: "We **were** on the bank", fixes: [{ wrong: "was", right: "were", why: "we → were", category: "согласование", slip: false }] }),
    );
    const h = botHarness({ tutor: tutor(reviewSentence) });
    const user = await setup(h, "modeSentence");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(texts(h).at(-1)).toContain("Составь своё предложение");
    await h.bot.handleUpdate(h.message(100, "We was on the bank"));
    await vi.waitFor(() => expect(texts(h).some((t) => t.includes("Слово употреблено верно"))).toBe(true));
    expect(reviewSentence).toHaveBeenCalledWith(expect.objectContaining({ term: "bank", answer: "We was on the bank" }));
    expect(await logs(h)).toEqual(["sentence:good"]);
    // Ничего не добавлено как новое слово, ошибки — только после подтверждения.
    expect(texts(h).some((t) => t.includes("Добавить"))).toBe(false);
    expect(await h.db.select().from(mistakes)).toHaveLength(0);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Сохранить")));
    expect((await h.db.select().from(mistakes)).map((m) => m.userId)).toEqual([user.id]);
  });

  it("counts a misused word as «Забыл» and shows an example", async () => {
    const h = botHarness({ tutor: tutor(async () => review({ usesWord: false, verdict: "Здесь bank — банк, а не берег" })) });
    await setup(h, "modeSentence");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.message(100, "I keep money in the bank"));
    await vi.waitFor(() => expect(texts(h).some((t) => t.includes("Слово употреблено неверно"))).toBe(true));
    expect(texts(h).find((t) => t.includes("неверно"))).toContain("We sat on the river bank.");
    expect(await logs(h)).toEqual(["sentence:again"]);
  });

  it("«🤷 Не знаю» shows the example and counts as «Забыл»", async () => {
    const h = botHarness({ tutor: tutor(async () => review()) });
    await setup(h, "modeSentence");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🤷 Не знаю")));
    expect(texts(h).some((t) => t.startsWith("🤷") && t.includes("We sat on the river bank."))).toBe(true);
    expect(await logs(h)).toEqual(["sentence:again"]);
  });
});

describe("🎧 dictation", () => {
  it("sends the pronunciation without the word and grades the typed answer", async () => {
    const h = botHarness();
    await setup(h, "modeListen");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const task = texts(h).at(-1)!;
    expect(task).toContain("Диктант");
    expect(task).not.toContain("bank");
    expect(h.calls.at(-1)?.method).toBe("sendVoice");
    await h.bot.handleUpdate(h.message(100, "Bank."));
    expect(texts(h).some((t) => t.startsWith("✅ Верно"))).toBe(true);
    expect(await logs(h)).toEqual(["listen:good"]);
  });

  it("a wrong answer shows the word and counts as «Забыл»", async () => {
    const h = botHarness();
    await setup(h, "modeListen");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.message(100, "punk"));
    expect(texts(h).find((t) => t.startsWith("❌"))).toContain("<s>punk</s>");
    expect(await logs(h)).toEqual(["listen:again"]);
  });

  it("falls back to a regular card when the voice can't be made", async () => {
    const h = botHarness({ speech: { synthesize: async () => Promise.reject(new Error("no say")) } });
    await setup(h, "modeListen");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(texts(h).at(-1)).toContain("bank");
    expect(h.calls.some((c) => c.method === "sendVoice")).toBe(false);
  });

  it("in practice outside the schedule it checks the answer without rating the card", async () => {
    const h = botHarness();
    await setup(h, "modeListen", true);
    const before = await h.db.select().from(cards).where(eq(cards.userId, 1));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    expect(texts(h).at(-1)).toContain("Диктант");
    await h.bot.handleUpdate(h.message(100, "bank"));
    expect(texts(h).some((t) => t.startsWith("✅ Верно"))).toBe(true);
    expect(await logs(h)).toEqual([]);
    expect(await h.db.select().from(cards).where(eq(cards.userId, 1))).toEqual(before);
  });
});
