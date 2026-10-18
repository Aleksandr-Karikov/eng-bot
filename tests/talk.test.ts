import { describe, expect, it, vi } from "vitest";
import { mistakes } from "../src/db/schema";
import type { ExerciseTutor, TalkInput, TalkReview } from "../src/llm/tutor";
import { buildTalkReplyPrompt, buildTalkReviewPrompt } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const review: TalkReview = {
  praise: "Хорошо держал разговор",
  fixes: [
    { wrong: "I has", right: "I have", why: "I → have", category: "согласование", slip: false },
    { wrong: "teh", right: "the", why: "", category: "орфография", slip: true },
  ],
  natural: [{ original: "I very like it", better: "I really like it" }],
  usedWords: ["prudent"],
};

async function setup() {
  let n = 0;
  const talkReply = vi.fn(async (_input: TalkInput) => `Bot line ${++n}?`);
  const talkReview = vi.fn(async (_input: TalkInput) => review);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), story: async () => ({ title: "", body: "", questions: [] }),
    untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), talkReply, talkReview, say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }),
  };
  const enrich = vi.fn(async () => ({ translation: "t", explanation: "", example: "" }));
  const h = botHarness({ tutor, enricher: { enrich, extract: async () => [], extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) } });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of ["prudent", "snag"]) await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
  return { h, talkReply, talkReview, enrich, user };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("🗣 /talk", () => {
  it("starts on a topic with the room's words, keeps the dialog and does not treat replies as new words", async () => {
    const { h, talkReply, enrich } = await setup();
    await h.bot.handleUpdate(h.message(100, "/talk"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "☕ В кафе")));
    await vi.waitFor(() => expect(sent(h).at(-1)).toBe("Bot line 1?"));
    expect(sent(h).some((t) => t.includes("Попробуй употребить") && t.includes("prudent"))).toBe(true);
    await h.bot.handleUpdate(h.message(100, "A latte please, I has no time"));
    await vi.waitFor(() => expect(sent(h).at(-1)).toBe("Bot line 2?"));
    const input = talkReply.mock.calls[1][0];
    expect(input.topic).toContain("barista");
    expect(input.lines).toEqual([
      { who: "bot", text: "Bot line 1?" },
      { who: "user", text: "A latte please, I has no time" },
      { who: "bot", text: "Bot line 2?" },
    ]);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("finishes with a review and offers to save the real mistakes", async () => {
    const { h, talkReview, user } = await setup();
    await h.bot.handleUpdate(h.message(100, "/talk поспорим о пицце"));
    await vi.waitFor(() => expect(sent(h).at(-1)).toBe("Bot line 1?"));
    await h.bot.handleUpdate(h.message(100, "I has a prudent plan"));
    await vi.waitFor(() => expect(sent(h).at(-1)).toBe("Bot line 2?"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🏁 Закончить")));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("🏁"))).toBe(true));
    expect(talkReview.mock.calls[0][0].topic).toBe("поспорим о пицце");
    const text = sent(h).find((t) => t.startsWith("🏁"))!;
    expect(text).toContain("<s>I has</s> → <b>I have</b>");
    expect(text).toContain("(описка)");
    expect(text).toContain("<i>I really like it</i>");
    expect(text).toContain("Употребил слова комнаты: <b>prudent</b>");
    expect(text).toContain("попробуй: snag");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Сохранить")));
    expect((await h.db.select().from(mistakes)).map((m) => [m.userId, m.wrong])).toEqual([[user.id, "I has"]]);
    // После разбора текст снова уходит в обычный поток (добавление слова).
    await h.bot.handleUpdate(h.message(100, "serendipity"));
    await vi.waitFor(() => expect(sent(h).at(-1)).not.toBe("Bot line 3?"));
  });

  it("works only in private chats", async () => {
    const { h } = await setup();
    await h.bot.handleUpdate(h.groupMessage(100, -1, "/talk"));
    expect(sent(h).at(-1)).toContain("в личке");
  });

  it("takes the reply out of JSON, or as is", async () => {
    const { parseTalkReply } = await import("../src/llm/tutor");
    expect(parseTalkReply('{"reply": "Hey! Seen anything good?"}')).toBe("Hey! Seen anything good?");
    expect(parseTalkReply("You: Hello there")).toBe("Hello there");
  });

  it("prompts: stay in the role, don't correct; review only the student's lines", () => {
    const input: TalkInput = { topic: "cafe", words: [{ term: "prudent", translation: "t" }], lines: [{ who: "bot", text: "Hi" }, { who: "user", text: "Hello" }] };
    expect(buildTalkReplyPrompt(input)).toContain("Не исправляй");
    expect(buildTalkReplyPrompt(input)).toContain("Student: Hello");
    expect(buildTalkReviewPrompt(input)).toContain("Разбери только реплики Student");
  });
});
