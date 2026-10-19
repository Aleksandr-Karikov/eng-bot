import { describe, expect, it, vi } from "vitest";
import type { ExerciseTutor } from "../src/llm/tutor";
import { createRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function tutor(over: Partial<ExerciseTutor>): ExerciseTutor {
  return {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story: async () => ({ title: "", body: "", questions: [] }),
    untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), talkReply: async () => "Bot line?", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }),
    say: async () => ({ variants: [], learn: [] }), collocations: async () => ({ items: [] }),
    translationTask: async () => ({ ru: "Привет.", en: "Hi.", topic: "", word: "" }),
    reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }),
    ...over,
  };
}

async function setup(t: ExerciseTutor) {
  const enrich = vi.fn(async () => ({ translation: "t", explanation: "", example: "" }));
  const h = botHarness({ tutor: t, enricher: { enrich, extract: async () => [], extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) } });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  return { h, enrich, user, room };
}
const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("input modes don't fight", () => {
  it("/translate that failed to make a sentence lets the DM go back to adding words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { h, enrich } = await setup(tutor({ translationTask: async () => Promise.reject(new Error("timeout")) }));
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Не получилось придумать"))).toBe(true));
    await h.bot.handleUpdate(h.message(100, "serendipity"));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalled());
  });

  it("starting /talk ends /translate, so talk lines are not graded as translations", async () => {
    const reviewTranslation = vi.fn(async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }));
    const talkReply = vi.fn(async () => "Bot line?");
    const { h } = await setup(tutor({ reviewTranslation, talkReply }));
    await h.bot.handleUpdate(h.message(100, "/translate"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Привет."))).toBe(true));
    await h.bot.handleUpdate(h.message(100, "/talk про погоду"));
    await vi.waitFor(() => expect(talkReply).toHaveBeenCalledTimes(1));
    await h.bot.handleUpdate(h.message(100, "It's raining again"));
    await vi.waitFor(() => expect(talkReply).toHaveBeenCalledTimes(2));
    expect(reviewTranslation).not.toHaveBeenCalled();
  });

  it("a command in the group does not cancel an exercise waiting in the DM", async () => {
    const { h, user, room } = await setup(tutor({}));
    await linkGroup(h.db, room.id, -500);
    h.deps.exercises.set(user.id, { kind: "sentence", cardId: 1, reps: 0, wordId: 1, term: "x", chatId: 100 });
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/stats"));
    expect(h.deps.exercises.get(user.id)).toBeDefined();
    await h.bot.handleUpdate(h.message(100, "/stats"));
    expect(h.deps.exercises.get(user.id)).toBeUndefined();
  });
});
