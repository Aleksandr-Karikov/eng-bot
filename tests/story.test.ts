import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs } from "../src/db/schema";
import type { ExerciseTutor, StoryDraft } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const draft: StoryDraft = {
  title: "The Hangar",
  body: "Tom was **frazzled**.\n\nHe hid in the **hangar**.",
  questions: [
    { question: "How did Tom feel?", options: ["Calm", "Exhausted"], correct: 1, explanation: "frazzled — измотанный" },
    { question: "Where did he hide?", options: ["In a hangar", "At home"], correct: 0, explanation: "" },
  ],
};

function setup(storyFn: ExerciseTutor["story"] = async () => draft) {
  const story = vi.fn(storyFn);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story,
  };
  const synthesize = vi.fn(async (_text: string, _accent: string) => Buffer.from("ogg"));
  return { h: botHarness({ tutor, speech: { synthesize } }), story, synthesize };
}

async function room(h: ReturnType<typeof botHarness>, terms: string[]) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const r = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of terms) await saveWord(h.db, { roomId: r.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
  return user;
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
const alerts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text));

describe("📖 /story", () => {
  it("writes a story from the room's words, words the reader forgot first, with a hidden glossary and questions", async () => {
    const { h, story } = setup();
    const user = await room(h, ["bank", "hangar", "frazzled", "prudent"]);
    const [forgotten] = await h.db.select().from(cards).where(eq(cards.wordId, 3));
    await h.db.insert(reviewLogs).values({ userId: user.id, cardId: forgotten.id, rating: "again", reviewedAt: T0 });
    await h.bot.handleUpdate(h.message(100, "/story"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("❓ 2/2"))).toBe(true));
    expect(story.mock.calls[0][0][0]).toEqual({ term: "frazzled", translation: "t-frazzled" });
    expect(story.mock.calls[0][0]).toHaveLength(4);
    const text = sent(h).find((t) => t.startsWith("📖 <b>"))!;
    expect(text).toContain("Tom was <b>frazzled</b>");
    expect(text).toMatch(/<tg-spoiler>[^]*hangar — t-hangar/);
  });

  it("answers each question privately in a popup", async () => {
    const { h } = setup();
    await room(h, ["bank", "hangar", "frazzled"]);
    await h.bot.handleUpdate(h.message(100, "/story"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("❓ 1/2"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "Calm")));
    expect(alerts(h).at(-1)).toBe("❌ Правильно: Exhausted\n\nfrazzled — измотанный");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "In a hangar")));
    expect(alerts(h).at(-1)).toBe("✅ Верно!");
  });

  it("reads the story aloud once and reuses the voice", async () => {
    const { h, synthesize } = setup();
    await room(h, ["bank", "hangar", "frazzled"]);
    await h.bot.handleUpdate(h.message(100, "/story"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("❓ 2/2"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔊 Послушать")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔊 Послушать")));
    expect(h.calls.filter((c) => c.method === "sendVoice")).toHaveLength(2);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0][0]).toBe("The Hangar.\n\nTom was frazzled.\n\nHe hid in the hangar.");
  });

  it("needs at least three words and reports Claude failures", async () => {
    const few = setup();
    await room(few.h, ["bank", "hangar"]);
    await few.h.bot.handleUpdate(few.h.message(100, "/story"));
    await vi.waitFor(() => expect(sent(few.h).some((t) => t.includes("хотя бы 3 слова"))).toBe(true));
    expect(few.story).not.toHaveBeenCalled();

    const broken = setup(async () => Promise.reject(new Error("timeout")));
    await room(broken.h, ["bank", "hangar", "frazzled"]);
    await broken.h.bot.handleUpdate(broken.h.message(100, "/story"));
    await vi.waitFor(() => expect(sent(broken.h).some((t) => t.includes("Не получилось написать историю"))).toBe(true));
  });
});
