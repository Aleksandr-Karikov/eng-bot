import { describe, expect, it, vi } from "vitest";
import { State } from "ts-fsrs";
import { ClozeGenerator } from "../src/services/cloze-generator";
import { listCloze, pickCloze, saveCloze } from "../src/services/cloze";
import { chooseStage, isExactAnswer, normalizeAnswer, targetStage } from "../src/services/exercises";
import { createRoom } from "../src/services/rooms";
import { deleteWord, saveWord, updateWord } from "../src/services/words";
import { buildClozePrompt, buildJudgePrompt, parseCloze, parseJudgement } from "../src/llm/tutor";
import { T0, makeUser, testDb } from "./helpers";

const all = { en_ru: true, ru_en: true, cloze: true };

describe("ladder", () => {
  it("picks the target stage by stability", () => {
    expect(targetStage({ state: State.New, stability: 0 })).toBe("en_ru");
    expect(targetStage({ state: State.Review, stability: 2.9 })).toBe("en_ru");
    expect(targetStage({ state: State.Review, stability: 3 })).toBe("ru_en");
    expect(targetStage({ state: State.Review, stability: 14 })).toBe("cloze");
  });

  it("skips disabled stages: nearest enabled below, otherwise above", () => {
    expect(chooseStage("cloze", all, true)).toBe("cloze");
    expect(chooseStage("cloze", { ...all, cloze: false }, true)).toBe("ru_en");
    expect(chooseStage("ru_en", { en_ru: true, ru_en: false, cloze: true }, true)).toBe("en_ru");
    expect(chooseStage("en_ru", { en_ru: false, ru_en: true, cloze: true }, true)).toBe("ru_en");
    expect(chooseStage("en_ru", { en_ru: false, ru_en: false, cloze: true }, true)).toBe("cloze");
  });

  it("falls back while cloze sentences are not ready", () => {
    expect(chooseStage("cloze", all, false)).toBe("ru_en");
    expect(chooseStage("en_ru", { en_ru: false, ru_en: false, cloze: true }, false)).toBe("en_ru");
  });
});

describe("answers", () => {
  it("normalizes case, spaces, trailing punctuation and curly apostrophes", () => {
    expect(normalizeAnswer("  Took   IT for granted!! ")).toBe("took it for granted");
    expect(normalizeAnswer("don’t")).toBe("don't");
  });

  it("accepts the form in the gap or the dictionary term", () => {
    expect(isExactAnswer("took it for granted.", { answer: "took it for granted", term: "take for granted" })).toBe(true);
    expect(isExactAnswer("Take for granted", { answer: "took it for granted", term: "take for granted" })).toBe(true);
    expect(isExactAnswer("assumed", { answer: "took it for granted", term: "take for granted" })).toBe(false);
  });
});

describe("cloze storage", () => {
  async function setupWord() {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
    if (r.status !== "saved") throw new Error("dup");
    return { db, word: r.word };
  }
  const items = [1, 2, 3].map((i) => ({ sentence: `s${i} ___`, answer: "bank", translation: `p${i}` }));

  it("saves, rotates by reps, and is removed with the word", async () => {
    const { db, word } = await setupWord();
    await saveCloze(db, word.id, items, T0);
    const saved = await listCloze(db, word.id);
    expect(saved.map((s) => s.sentence)).toEqual(["s1 ___", "s2 ___", "s3 ___"]);
    expect(pickCloze(saved, 4)?.sentence).toBe("s2 ___");
    expect(pickCloze([], 0)).toBeUndefined();
    await deleteWord(db, word.id);
    expect(await listCloze(db, word.id)).toEqual([]);
  });

  it("is cleared when the word's meaning changes, kept when only the example changes", async () => {
    const { db, word } = await setupWord();
    await saveCloze(db, word.id, items, T0);
    await updateWord(db, word.id, { translation: "берег", explanation: "x", example: "y" });
    expect(await listCloze(db, word.id)).toHaveLength(3);
    await updateWord(db, word.id, { translation: "банк", explanation: "x", example: "y" });
    expect(await listCloze(db, word.id)).toEqual([]);
  });

  it("generates once in the background, even when asked twice at the same time", async () => {
    const { db, word } = await setupWord();
    const cloze = vi.fn(async () => items);
    const gen = new ClozeGenerator(db, { cloze, judge: vi.fn(), drill: vi.fn(), mnemonic: vi.fn() }, () => T0);
    await Promise.all([gen.ensure(word), gen.ensure(word)]);
    await gen.ensure(word);
    expect(cloze).toHaveBeenCalledTimes(1);
    expect(await listCloze(db, word.id)).toHaveLength(3);
  });
});

describe("tutor parsing", () => {
  it("parses cloze sentences and drops ones without a gap", () => {
    const raw = JSON.stringify([
      { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу реки." },
      { sentence: "No gap here", answer: "bank", translation: "x" },
    ]);
    expect(parseCloze("```json\n" + raw + "\n```")).toEqual([
      { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу реки." },
    ]);
    expect(buildClozePrompt("bank", "берег")).toContain("bank");
  });

  it("parses a judgement", () => {
    expect(parseJudgement(JSON.stringify({ correct: true, explanation: "синоним", tip: "" }))).toEqual({ correct: true, explanation: "синоним", tip: "" });
    expect(parseJudgement(JSON.stringify({ correct: false }))).toEqual({ correct: false, explanation: "", tip: "" });
    expect(() => parseJudgement("hmm")).toThrow();
    const p = buildJudgePrompt({ sentence: "We sat on the ___.", expected: "bank", term: "bank", translation: "берег", answer: "shore" });
    expect(p).toContain("shore");
    expect(p).toContain("We sat on the ___.");
  });
});
