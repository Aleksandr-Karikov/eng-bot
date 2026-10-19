import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, mistakes, reviewLogs } from "../src/db/schema";
import type { ExerciseTutor, TranslationInput, TranslationReview, TranslationTask } from "../src/llm/tutor";
import { buildTranslationTaskPrompt } from "../src/llm/tutor";
import { recordMistakes } from "../src/services/mistakes";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const tasks: TranslationTask[] = [
  { ru: "Мы немного опаздываем, начинайте без нас.", en: "We're running a bit late, start without us.", topic: "времена", word: "run late" },
  { ru: "Это окупится.", en: "It will pay off.", topic: "", word: "" },
  { ru: "Третье.", en: "Third.", topic: "", word: "" },
];

async function setup(review: TranslationReview) {
  let n = 0;
  const translationTask = vi.fn(async (_input: TranslationInput) => tasks[Math.min(n++, tasks.length - 1)]);
  const reviewTranslation = vi.fn(async () => review);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story: async () => ({ title: "", body: "", questions: [] }),
    untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), talkReply: async () => "", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }),
    say: async () => ({ variants: [], learn: [] }), collocations: async () => ({ items: [] }), translationTask, reviewTranslation,
  };
  const enrich = vi.fn(async () => ({ translation: "t", explanation: "", example: "" }));
  const h = botHarness({ tutor, enricher: { enrich, extract: async () => [], extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) } });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "run late", translation: "опаздывать", explanation: "", example: "", usefulness: 3 }, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "trump the kipper", translation: "переплюнуть", explanation: "", example: "", usefulness: 1 }, now: T0 });
  await h.db.update(cards).set({ state: 2, stability: 3, reps: 3 });
  await recordMistakes(h.db, user.id, [{ wrong: "we are late", right: "we're running late", why: "", category: "времена" }], T0);
  return { h, translationTask, reviewTranslation, enrich, user };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("🇷🇺→🇬🇧 /translate", () => {
  it("builds sentences from open mistake topics and words being learned, but not optional ones", async () => {
    const { h, translationTask } = await setup({ correct: true, fixes: [], corrected: "", natural: "", usedWord: true, verdict: "" });
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Мы немного опаздываем"))).toBe(true));
    const input = translationTask.mock.calls[0][0];
    expect(input.topics.map((t) => t.category)).toEqual(["времена"]);
    expect(input.words.map((w) => w.term)).toEqual(["run late"]);
  });

  it("a right answer counts towards the topic and as a review of the word; the reply is not a new word", async () => {
    const { h, enrich, reviewTranslation } = await setup({ correct: true, fixes: [], corrected: "", natural: "", usedWord: true, verdict: "Отлично" });
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Мы немного опаздываем"))).toBe(true));
    await h.bot.handleUpdate(h.message(100, "We're running a bit late, start without us"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("✅ Верно"))).toBe(true));
    const result = sent(h).find((t) => t.startsWith("✅ Верно"))!;
    expect(result).toContain("засчитано как повторение");
    expect(result).toContain("«времена»: 1/3");
    expect((await h.db.select().from(reviewLogs)).map((l) => `${l.stage}:${l.rating}`)).toEqual(["translate:good"]);
    expect(reviewTranslation).toHaveBeenCalledWith({ task: expect.objectContaining({ word: "run late" }), answer: "We're running a bit late, start without us" });
    expect(enrich).not.toHaveBeenCalled();
    // Сразу следующее предложение.
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Это окупится"))).toBe(true));
  });

  it("saves real mistakes right away and resets the topic count", async () => {
    const { h, user } = await setup({
      correct: false,
      fixes: [
        { wrong: "we late", right: "we're running late", why: "", category: "времена", slip: false },
        { wrong: "strat", right: "start", why: "", category: "орфография", slip: true },
      ],
      corrected: "**We're running** late, **start** without us",
      natural: "",
      usedWord: false,
      verdict: "",
    });
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Мы немного опаздываем"))).toBe(true));
    await h.bot.handleUpdate(h.message(100, "We late, strat without us"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("❌"))).toBe(true));
    const result = sent(h).find((t) => t.startsWith("❌"))!;
    expect(result).toContain("Здесь просилось <b>run late</b>");
    expect(result).toContain("счёт заново");
    expect((await h.db.select().from(mistakes).where(eq(mistakes.userId, user.id))).map((m) => m.wrong)).toEqual(["we are late", "we late"]);
    expect(await h.db.select().from(reviewLogs)).toEqual([]);
  });

  it("«🤷 Не знаю» shows a translation and moves on; «⏹ Хватит» sums up", async () => {
    const { h } = await setup({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" });
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Мы немного опаздываем"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🤷 Не знаю")));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Можно так") && t.includes("running a bit late"))).toBe(true));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Это окупится"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⏹ Хватит")));
    expect(sent(h).at(-1)).toContain("Ок, в другой раз");
  });

  it("the prompt asks for one topic and a word only if it fits naturally", () => {
    const p = buildTranslationTaskPrompt({ topics: [{ category: "артикли", examples: [{ wrong: "a", right: "the" }] }], words: [{ term: "run late", translation: "опаздывать" }], avoid: ["Старое."] });
    expect(p).toContain("артикли: a → the");
    expect(p).toContain("Не натягивай");
    expect(p).toContain("- Старое.");
  });
});
