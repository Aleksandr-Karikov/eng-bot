import { describe, expect, it, vi } from "vitest";
import { State } from "ts-fsrs";
import { ClozeGenerator } from "../src/services/cloze-generator";
import { listCloze, pickCloze, saveCloze } from "../src/services/cloze";
import { gradeDictation, isExactAnswer, normalizeAnswer, pickStage } from "../src/services/exercises";
import { createRoom } from "../src/services/rooms";
import { deleteWord, saveWord, updateWord } from "../src/services/words";
import { buildClozePrompt, buildJudgePrompt, parseCloze, parseJudgement } from "../src/llm/tutor";
import { T0, makeUser, testDb } from "./helpers";

const old = { en_ru: true, ru_en: true, cloze: true, sentence: false, listen: false, collocation: false };
const all = old;
const every = { en_ru: true, ru_en: true, cloze: true, sentence: true, listen: true, collocation: false };

describe("picking the exercise", () => {
  const card = (state: number) => ({ state, stability: 1 });

  it("shows a brand-new word as EN → RU first (it can't be recalled yet)", () => {
    expect(pickStage(card(State.New), all, true, () => 0.99)).toBe("en_ru");
    expect(pickStage(card(State.New), { ...all, en_ru: false }, true, () => 0)).toBe("ru_en");
  });

  it("otherwise picks randomly among the enabled modes, no difficulty ladder", () => {
    expect(pickStage(card(State.Review), all, true, () => 0)).toBe("en_ru");
    expect(pickStage(card(State.Review), all, true, () => 0.5)).toBe("ru_en");
    expect(pickStage(card(State.Review), all, true, () => 0.99)).toBe("cloze");
    expect(pickStage(card(State.Learning), { ...all, ru_en: false }, true, () => 0.99)).toBe("cloze");
  });

  it("skips fill-in-the-gap while its sentences are not ready, and falls back to EN → RU if nothing else is on", () => {
    expect(pickStage(card(State.Review), all, false, () => 0.99)).toBe("ru_en");
    expect(pickStage(card(State.Review), { ...old, en_ru: false, ru_en: false }, false, () => 0.5)).toBe("en_ru");
  });
});

describe("own sentence and dictation in the mix", () => {
  const card = (state: number, reps: number) => ({ state, reps });

  it("never starts a new word with an own sentence or a gap, dictation is fine", () => {
    expect(pickStage(card(State.New, 0), { ...every, en_ru: false, ru_en: false }, true, () => 0)).toBe("listen");
  });

  it("asks for an own sentence only after a couple of reviews", () => {
    const only = { ...every, en_ru: false, ru_en: false, cloze: false, listen: false };
    expect(pickStage(card(State.Learning, 1), only, true, () => 0)).toBe("en_ru");
    expect(pickStage(card(State.Review, 2), only, true, () => 0)).toBe("sentence");
    expect(pickStage(card(State.Review, 5), every, true, () => 0.99)).toBe("listen");
  });

  it("grades dictation: exact, a typo in a long word, or wrong", () => {
    expect(gradeDictation("Prudent.", "prudent")).toBe("exact");
    expect(gradeDictation("prudant", "prudent")).toBe("close");
    expect(gradeDictation("we are runing a little bit later", "we are running a little bit later")).toBe("close");
    expect(gradeDictation("rot", "rat")).toBe("wrong");
    expect(gradeDictation("student", "prudent")).toBe("wrong");
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
    const gen = new ClozeGenerator(db, { cloze, judge: vi.fn(), drill: vi.fn(), mnemonics: vi.fn(), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: vi.fn() }, () => T0);
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
    expect(buildClozePrompt("take it for granted", "принимать как должное")).toMatch(/фраз[^]*только ключев/);
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
