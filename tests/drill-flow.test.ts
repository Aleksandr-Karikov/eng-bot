import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/llm/enricher";
import type { DrillQuestion, ExerciseTutor } from "../src/llm/tutor";
import { recentMistakes, recordMistakes } from "../src/services/mistakes";
import { nextDue } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const checked: CheckResult = {
  corrected: "I **went** there",
  fixes: [{ wrong: "go", right: "went", why: "прошлое", category: "времена: Present вместо Past" }],
  natural: "",
};
const question = (n: number): DrillQuestion => ({
  question: `Q${n}: Tomorrow I ___ my mom.`,
  options: ["visit", "am visiting", "visited"],
  correct: 1,
  explanation: "планы на будущее — Present Continuous",
  category: "времена",
});

function harness(drill = vi.fn(async () => [question(1), question(2)])) {
  const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill, mnemonics: async () => [], story: async () => ({ title: "", body: "", questions: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "" };
  const h = botHarness({
    tutor,
    enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], check: async () => checked },
  });
  return { h, drill };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

describe("/check records mistakes for whoever made them", () => {
  it("records for the author of the replied message, not the caller", async () => {
    const { h } = harness();
    const caller = await makeUser(h.db, 100);
    const author = await makeUser(h.db, 200);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/check", { messageId: 5, fromId: 200, text: "I go there" }));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Сохранить ошибки User200"))).toBe(true));
    expect(sent(h).find((t) => t.includes("Сохранить ошибки"))).toContain("времена: Present вместо Past");
    await h.bot.handleUpdate(h.groupCallback(100, -500, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, author.id, T0)).toHaveLength(1);
    expect(await recentMistakes(h.db, caller.id, T0)).toHaveLength(0);
  });

  it("skips authors who do not use the bot, and records the caller's own /check text", async () => {
    const { h } = harness();
    const caller = await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/check", { messageId: 5, fromId: 999_001, text: "I go there" }));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Исправлено"))).toBe(true));
    const notSaved = sent(h).find((t) => t.includes("Исправлено"))!;
    expect(notSaved).toContain("User999001 ещё не пользуется ботом");
    expect(notSaved).toContain("https://t.me/test_bot");
    expect(await recentMistakes(h.db, caller.id, T0)).toHaveLength(0);

    await h.bot.handleUpdate(h.message(100, "/check I go there"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Сохранить твои ошибки"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, caller.id, T0)).toHaveLength(1);
  });
});

describe("/check slips", () => {
  it("shows a typo fix but does not save it or claim it was saved", async () => {
    const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], story: async () => ({ title: "", body: "", questions: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "" };
    const h = botHarness({
      tutor,
      enricher: {
        enrich: async () => ({ translation: "", explanation: "", example: "" }),
        extract: async () => [],
        check: async () => ({ corrected: "**thx**", fixes: [{ wrong: "ths", right: "thx", why: "опечатка", category: "орфография", slip: true }], natural: "" }),
      },
    });
    const user = await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/check ths"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Исправлено"))).toBe(true));
    expect(sent(h).some((t) => t.includes("🧠"))).toBe(false);
    expect(await recentMistakes(h.db, user.id, T0)).toHaveLength(0);
  });
});

describe("/mistakes", () => {
  it("shows the profile and resets it", async () => {
    const { h } = harness();
    const user = await makeUser(h.db, 100);
    await recordMistakes(h.db, user.id, [{ wrong: "go", right: "went", category: "времена" }, { wrong: "a", right: "the", category: "артикли" }], T0);
    await h.bot.handleUpdate(h.message(100, "/mistakes"));
    expect(sent(h).at(-1)).toContain("времена");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Сбросить")));
    expect(await recentMistakes(h.db, user.id, T0)).toHaveLength(0);
  });
});

describe("drill questions in /learn", () => {
  async function learner(h: ReturnType<typeof botHarness>, mistakeCount: number, drillOn = true) {
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, modeDrill: drillOn });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    for (let i = 0; i < 8; i++) {
      await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: `w${i}`, translation: `t${i}`, explanation: "", example: "" }, now: new Date(T0.getTime() - DAY + i) });
    }
    await recordMistakes(h.db, user.id, Array.from({ length: mistakeCount }, () => ({ wrong: "go", right: "went", category: "времена" })), T0);
    return user;
  }
  async function answerCards(h: ReturnType<typeof botHarness>, userId: number, n: number) {
    for (let i = 0; i < n; i++) {
      const item = (await nextDue(h.db, userId, T0))!;
      await h.bot.handleUpdate(h.callback(100, `r:${item.card.id}:${item.card.reps}:g`));
    }
  }

  it("mixes a question in every 5 answers and explains the answer", async () => {
    const { h, drill } = harness();
    const user = await learner(h, 3);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await vi.waitFor(() => expect(drill).toHaveBeenCalled());
    await answerCards(h, user.id, 5);
    expect(sent(h).at(-1)).toContain("🧠");
    expect(sent(h).at(-1)).toContain("Q1: Tomorrow I ___ my mom.");
    expect(lastButtons(h.calls).map((b) => b.text)).toEqual(["visit", "am visiting", "visited"]);

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "visit")));
    const result = h.calls.filter((c) => c.method === "editMessageText").at(-1)!;
    expect(String(result.payload.text)).toContain("❌");
    expect(String(result.payload.text)).toContain("Tomorrow I <b>am visiting</b> my mom.");
    expect(String(result.payload.text)).toContain("Present Continuous");
    expect(String(sent(h).at(-1))).not.toContain("🧠");
  });

  it("does not prepare questions without any mistakes or with the mode off", async () => {
    const a = harness();
    await learner(a.h, 0);
    await a.h.bot.handleUpdate(a.h.message(100, "/learn"));
    const b = harness();
    await learner(b.h, 5, false);
    await b.h.bot.handleUpdate(b.h.message(100, "/learn"));
    await new Promise((r) => setTimeout(r, 50));
    expect(a.drill).not.toHaveBeenCalled();
    expect(b.drill).not.toHaveBeenCalled();
  });

  it("prepares questions even when the session was not started with /learn (e.g. after a bot restart)", async () => {
    const { h, drill } = harness();
    const user = await learner(h, 1);
    await answerCards(h, user.id, 5);
    expect(drill).toHaveBeenCalledTimes(1);
    expect(sent(h).at(-1)).toContain("🧠");
  });

  it("starts from a single mistake", async () => {
    const { h, drill } = harness();
    await learner(h, 1);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await vi.waitFor(() => expect(drill).toHaveBeenCalled());
  });

  it("/drill runs the questions on their own", async () => {
    const { h } = harness();
    await learner(h, 3);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Q1:"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "am visiting")));
    expect(String(h.calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text)).toContain("✅");
    expect(sent(h).at(-1)).toContain("Q2:");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "am visiting")));
    expect(sent(h).at(-1)).toContain("Готово");
  });

  it("rejects a button from an older question instead of grading the current one", async () => {
    const { h } = harness();
    await learner(h, 1);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Q1:"))).toBe(true));
    const stale = buttonData(h.calls, "am visiting");
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Q2:"))).toBe(true));
    const edits = h.calls.filter((c) => c.method === "editMessageText").length;
    await h.bot.handleUpdate(h.callback(100, stale));
    expect(h.calls.filter((c) => c.method === "editMessageText")).toHaveLength(edits);
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("неактуален");
  });

  it("toggles the mode in /settings", async () => {
    const { h } = harness();
    const user = await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ 🧠 Работа над ошибками")));
    expect((await getUser(h.db, user.id))?.modeDrill).toBe(false);
  });
});
