import { describe, expect, it, vi } from "vitest";
import type { ExerciseTutor, SayAnswer } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const answer: SayAnswer = {
  variants: [
    { text: "That was awkward.", register: "нейтрально", note: "" },
    { text: "Well, that's embarrassing.", register: "разговорно", note: "с иронией" },
  ],
  learn: [{ term: "awkward", translation: "неловкий" }],
};

async function setup() {
  const say = vi.fn(async (_phrase: string) => answer);
  const tutor: ExerciseTutor = {
    cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => ["memo"], imagePrompt: async () => "",
    reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }),
    untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), talkReply: async () => "", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), say,
  };
  const h = botHarness({ tutor });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  return { h, say };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("🇬🇧 /say", () => {
  it("gives natural variants with a register and offers to add the key expression", async () => {
    const { h, say } = await setup();
    await h.bot.handleUpdate(h.message(100, "/say неудобно получилось"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("🇬🇧"))).toBe(true));
    expect(say).toHaveBeenCalledWith("неудобно получилось");
    const text = sent(h).find((t) => t.startsWith("🇬🇧"))!;
    expect(text).toContain("<b>That was awkward.</b>");
    expect(text).toContain("<i>разговорно — с иронией</i>");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ awkward")));
    // Дальше — обычный черновик /add с переводом из /say.
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("awkward") && t.includes("неловкий") && !t.startsWith("🇬🇧"))).toBe(true));
  });

  it("works as a reply to a message and explains how to use it", async () => {
    const { h, say } = await setup();
    await h.bot.handleUpdate(h.message(100, "/say"));
    expect(sent(h).at(-1)).toContain("/say неудобно получилось");
    const reply = h.groupMessage(100, -1, "/say");
    reply.message!.reply_to_message = { message_id: 5, date: 0, chat: reply.message!.chat, text: "давай созвонимся вечером" } as never;
    await h.bot.handleUpdate(reply);
    await vi.waitFor(() => expect(say).toHaveBeenCalledWith("давай созвонимся вечером"));
  });
});
