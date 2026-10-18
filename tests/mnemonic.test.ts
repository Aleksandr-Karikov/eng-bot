import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import type { ExerciseTutor } from "../src/llm/tutor";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function tutor(
  mnemonics = vi.fn(async (items: Array<{ term: string }>) => items.map(() => "Ангар — огромный «гараж» для самолёта")),
): ExerciseTutor & { mnemonics: typeof mnemonics } {
  return { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics, story: async () => ({ title: "", body: "", questions: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "a scene" };
}

async function setup(h: ReturnType<typeof botHarness>) {
  const alice = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const bob = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
  await joinRoom(h.db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
  const r = await saveWord(h.db, { roomId: room.id, addedBy: alice.id, draft: { term: "hangar", translation: "ангар", explanation: "", example: "" }, now: T0 });
  if (r.status !== "saved") throw new Error("dup");
  return { alice, bob, word: r.word };
}

async function forget(h: ReturnType<typeof botHarness>, userId: number, tgId: number, times: number) {
  for (let i = 0; i < times; i++) {
    const [card] = await h.db.select().from(cards).where(eq(cards.userId, userId));
    await h.bot.handleUpdate(h.callback(tgId, `r:${card.id}:${card.reps}:a`));
  }
}

describe("hard words", () => {
  it("asks Claude for a mnemonic once a word has been forgotten 4 times", async () => {
    const t = tutor();
    const h = botHarness({ tutor: t });
    const { alice, word } = await setup(h);
    await forget(h, alice.id, 100, 3);
    expect(t.mnemonics).not.toHaveBeenCalled();
    await forget(h, alice.id, 100, 2);
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.mnemonic).toContain("гараж"));
    expect(t.mnemonics).toHaveBeenCalledTimes(1);
    expect(t.mnemonics).toHaveBeenCalledWith([{ term: "hangar", translation: "ангар" }]);
  });

  it("shows the mnemonic under the spoiler on everyone's cards once it exists", async () => {
    const h = botHarness({ tutor: tutor() });
    const { alice, word } = await setup(h);
    await forget(h, alice.id, 100, 4);
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.mnemonic).not.toBe(""));
    const text = (tg: number) => [...h.calls].reverse().find((c) => c.method === "sendMessage" && c.payload.chat_id === tg)?.payload.text;

    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(String(text(100))).toMatch(/<tg-spoiler>[^]*💡[^]*гараж[^]*<\/tg-spoiler>/);
    await h.bot.handleUpdate(h.message(200, "/learn"));
    expect(String(text(200))).toMatch(/<tg-spoiler>[^]*💡[^]*гараж/);
  });

  it("forgets the mnemonic when the meaning changes", async () => {
    const h = botHarness({ tutor: tutor() });
    const { alice, word } = await setup(h);
    await forget(h, alice.id, 100, 4);
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.mnemonic).not.toBe(""));
    await updateWord(h.db, word.id, { translation: "ангар, сарай", explanation: "", example: "" });
    expect((await getWord(h.db, word.id))?.mnemonic).toBe("");
  });


});
