import { describe, expect, it, vi } from "vitest";
import { buildImagePromptPrompt, buildMnemonicPrompt, parseMnemonics, type ExerciseTutor } from "../src/llm/tutor";
import { buildPrompt, buildExtractPrompt } from "../src/llm/enricher";
import { MnemonicGenerator } from "../src/services/hard-words";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

function tutor(final = (term: string) => `m-${term}`) {
  const mnemonics = vi.fn(async (items: Array<{ term: string; translation: string }>) => items.map((i) => final(i.term)));
  const t: ExerciseTutor = {
    cloze: async () => [],
    judge: async () => ({ correct: false, explanation: "", tip: "" }),
    drill: async () => [],
    mnemonics,
    story: async () => ({ title: "", body: "", questions: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "scene",
  };
  return { t, mnemonics };
}

describe("two-step mnemonic prompt", () => {
  it("asks for candidates of each technique and a final built from the strong ones", () => {
    const p = buildMnemonicPrompt([{ term: "beset by", translation: "осаждаемый" }, { term: "heritage", translation: "наследие" }]);
    for (const part of ["image", "parts", "link", "scene", "final", "1. beset by", "2. heritage"]) expect(p).toContain(part);
  });

  it("returns finals in the order of the items, empty where missing", () => {
    const raw = JSON.stringify([
      { i: 2, candidates: [], final: "heir — наследник", used: ["parts"] },
      { i: 1, candidates: [], final: "бесы сели вокруг", used: ["image"] },
    ]);
    expect(parseMnemonics("```json\n" + raw + "\n```", 3)).toEqual(["бесы сели вокруг", "heir — наследник", ""]);
  });

  it("the translation prompts no longer ask for a mnemonic (it has its own model)", () => {
    expect(buildPrompt("bank")).not.toContain("mnemonic");
    expect(buildExtractPrompt("bank")).not.toContain("mnemonic");
  });
});

describe("pictures show the word, not the mnemonic", () => {
  it("builds the scene from the meaning, explanation and example", () => {
    const p = buildImagePromptPrompt({ term: "heritage", translation: "наследие", explanation: "то, что передаётся", example: "Our cultural heritage." });
    expect(p).toContain("heritage");
    expect(p).toContain("Our cultural heritage.");
    expect(p).not.toMatch(/запоминалк/i);
  });
});

describe("where mnemonics come from", () => {
  it("/add writes the mnemonic in parallel with the translation and shows it in the draft", async () => {
    const { t, mnemonics } = tutor();
    const h = botHarness({ tutor: t });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/add heritage"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    expect(mnemonics).toHaveBeenCalledWith([{ term: "heritage", translation: "" }]);
    expect(h.calls.some((c) => String(c.payload.text).includes("💡 m-heritage"))).toBe(true);
  });

  it("/text fills mnemonics for the saved words in the background, in one batch", async () => {
    const { t, mnemonics } = tutor();
    const h = botHarness({
      tutor: t,
      enricher: {
        enrich: async () => ({ translation: "x", explanation: "", example: "" }),
        extractImage: async () => [], extract: async () => ["heritage", "fuse"].map((term) => ({ term, translation: `t-${term}`, explanation: "", example: "" })),
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
    });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/text heritage fuse"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Добавить")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Добавить")));
    await vi.waitFor(async () => expect((await getWord(h.db, 2))?.mnemonic).toBe("m-fuse"));
    expect((await getWord(h.db, 1))?.mnemonic).toBe("m-heritage");
    expect(mnemonics).toHaveBeenCalledTimes(1);
  });

  it("MnemonicGenerator.ensureMany only asks for words that have none", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    const ids: number[] = [];
    for (const [term, mnemonic] of [["a", ""], ["b", "kept"], ["c", ""]] as const) {
      const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "", mnemonic }, now: T0 });
      if (r.status === "saved") ids.push(r.word.id);
    }
    const { t, mnemonics } = tutor();
    await new MnemonicGenerator(db, t).ensureMany(ids);
    expect(mnemonics).toHaveBeenCalledWith([{ term: "a", translation: "t" }, { term: "c", translation: "t" }]);
    expect((await getWord(db, ids[1]))?.mnemonic).toBe("kept");
    expect((await getWord(db, ids[2]))?.mnemonic).toBe("m-c");
  });
});
