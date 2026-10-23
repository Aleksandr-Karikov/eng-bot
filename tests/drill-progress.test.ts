import { describe, expect, it, vi } from "vitest";
import type { DrillQuestion, ExerciseTutor } from "../src/llm/tutor";
import { buildDrillPrompt } from "../src/llm/tutor";
import { recentMistakes, recordDrillAnswer, recordMistakes, resolvedTopics } from "../src/services/mistakes";
import { updateUser } from "../src/services/users";
import { botHarness, buttonData } from "./bot-harness";
import { MIN, T0, makeUser, testDb } from "./helpers";

const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);
const fix = (category: string) => ({ wrong: "a", right: "the", why: "", category });

describe("drill progress closes a topic", () => {
  it("closes a topic after three right answers in a row, a wrong one resets the count", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    await recordMistakes(db, user.id, [fix("артикли"), fix("артикли"), fix("предлоги")], at(0));
    expect((await recordDrillAnswer(db, user.id, "артикли", true, at(1)))?.streak).toBe(1);
    expect((await recordDrillAnswer(db, user.id, "артикли", false, at(2)))?.streak).toBe(0);
    await recordDrillAnswer(db, user.id, "артикли", true, at(3));
    await recordDrillAnswer(db, user.id, "Артикли", true, at(4));
    expect(await recordDrillAnswer(db, user.id, "артикли", true, at(5))).toEqual({ category: "артикли", streak: 3, resolved: true });
    expect((await recentMistakes(db, user.id, at(6))).map((m) => m.category)).toEqual(["предлоги"]);
    expect(await resolvedTopics(db, user.id, at(6))).toEqual(new Map([["артикли", 2]]));
  });

  it("a new mistake in a closed topic reopens it with a fresh count", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    await recordMistakes(db, user.id, [fix("артикли")], at(0));
    for (let i = 1; i <= 3; i++) await recordDrillAnswer(db, user.id, "артикли", true, at(i));
    await recordMistakes(db, user.id, [fix("артикли")], at(10));
    expect((await recentMistakes(db, user.id, at(11))).map((m) => m.category)).toEqual(["артикли"]);
    expect((await recordDrillAnswer(db, user.id, "артикли", true, at(12)))?.streak).toBe(1);
  });

  it("ignores questions on topics with nothing open", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    expect(await recordDrillAnswer(db, user.id, "времена", true, at(1))).toBeUndefined();
  });

  it("asks Claude not to repeat recent questions", () => {
    expect(buildDrillPrompt("артикли ×2", 3, ["I saw ___ cat."])).toContain("- I saw ___ cat.");
  });
});

describe("/drill shows the progress", () => {
  const q = (n: number, category = "артикли"): DrillQuestion => ({ question: `Q${n} ___`, options: ["a", "the"], correct: 1, explanation: "", category });

  it("counts right answers, then drops the remaining questions on a closed topic", async () => {
    const drill = vi.fn(async (_profile: string, _count: number, _avoid?: string[]) => [q(1), q(2), q(3), q(4), q(5, "предлоги")]);
    const tutor: ExerciseTutor = {
      cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill, mnemonics: async () => [], imagePrompt: async () => "",
      translationTask: async () => ({ ru: "Привет", en: "Hi", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }),
      reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }),
    };
    const h = botHarness({ tutor });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await recordMistakes(h.db, user.id, [fix("артикли"), fix("предлоги")], T0);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "the")).not.toThrow());
    const texts = () => h.calls.filter((c) => c.method === "editMessageText" || c.method === "sendMessage").map((c) => String(c.payload.text));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "the")));
    expect(texts().some((t) => t.includes("«артикли»: 1/3"))).toBe(true);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "the")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "the")));
    expect(texts().at(-1)).toContain("Тема «артикли» отработана");
    // Q4 тоже про артикли — пропущен, следующий (по «▶ Дальше») сразу про предлоги.
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "▶ Дальше")));
    expect(texts().at(-1)).toContain("Q5");
    // Следующий набор вопросов — без уже заданных.
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "the")));
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(drill).toHaveBeenCalledTimes(2));
    expect(drill.mock.calls[1]).toEqual([expect.not.stringContaining("артикли"), 3, ["Q1 ___", "Q2 ___", "Q3 ___", "Q5 ___"]]);
  });
});
