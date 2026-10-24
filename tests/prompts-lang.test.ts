import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as e from "../src/llm/enricher";
import * as t from "../src/llm/tutor";
import { LANGUAGES, type Language } from "../src/lang";

/** Все промпты с фиксированными входными данными; lang не передан — как вызывал код до появления языков. */
function prompts(L?: Language): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (f: (...args: any[]) => string, ...xs: unknown[]) => f(...xs, ...(L ? [L] : []));
  const word = { term: "take for granted", translation: "принимать как должное", explanation: "не ценить", example: "Don't take me for granted.", mnemonic: "грант" };
  const talk = { topic: "cafe", words: [{ term: "keen", translation: "увлечённый" }], lines: [{ who: "bot" as const, text: "Hi!" }, { who: "user" as const, text: "I has coffee" }] };
  const task = { ru: "Я рад", en: "I'm glad", topic: "", word: "" };
  return {
    system: L ? e.systemPrompt(L) : e.SYSTEM_PROMPT,
    enrich: call(e.buildPrompt, "bank", undefined, undefined),
    enrichHint: call(e.buildPrompt, "bank", "берег", "on the bank of the river"),
    enrichRu: call(e.buildPrompt, "зуб", undefined, undefined),
    extract: call(e.buildExtractPrompt, "Some text here."),
    extractImage: call(e.buildExtractImagePrompt, "только идиомы"),
    readImage: call(e.buildReadImagePrompt),
    check: call(e.buildCheckPrompt, "I has a cat", [{ author: "Ann", text: "hi" }], "Bob", ["So"]),
    checkPlain: call(e.buildCheckPrompt, "I has a cat", [], undefined, []),
    cloze: call(t.buildClozePrompt, "keen", "увлечённый"),
    judge: call(t.buildJudgePrompt, { sentence: "He is ___ on it.", expected: "keen", term: "keen", translation: "увлечённый", answer: "kean" }),
    sentence: call(t.buildSentencePrompt, { term: "keen", translation: "увлечённый", explanation: "", answer: "I am keen." }),
    untangle: call(t.buildUntanglePrompt, word),
    translationTask: call(t.buildTranslationTaskPrompt, { topics: [{ category: "артикли", examples: [{ wrong: "a apple", right: "an apple" }] }], words: [{ term: "keen", translation: "увлечённый" }], avoid: ["Я рад"] }),
    translationReview: call(t.buildTranslationReviewPrompt, { task, answer: "I glad" }),
    collocations: call(t.buildCollocationsPrompt, "keen", "увлечённый"),
    say: call(t.buildSayPrompt, "я соскучился"),
    talkReply: call(t.buildTalkReplyPrompt, talk),
    talkReview: call(t.buildTalkReviewPrompt, talk),
    story: call(t.buildStoryPrompt, [{ term: "keen", translation: "увлечённый" }]),
    drill: call(t.buildDrillPrompt, "артикли ×3: a apple → an apple", 3, ["old q"]),
    mnemonic: call(t.buildMnemonicPrompt, [{ term: "keen", translation: "увлечённый" }, { term: "bank", translation: "", instead: "банка" }]),
    image: call(t.buildImagePromptPrompt, { ...word, wish: "кот" }),
  };
}

describe("prompts by language", () => {
  // Эталон снят до появления языков: английский должен остаться байт в байт прежним.
  const before = JSON.parse(readFileSync(new URL("./fixtures/prompts-en.json", import.meta.url), "utf8"));

  it("English prompts are exactly what they were before languages — with and without an explicit language", () => {
    expect(prompts()).toEqual(before);
    expect(prompts(LANGUAGES.en)).toEqual(before);
  });

  it("Korean prompts talk about Korean (English is left only where meant: loanwords and the FLUX scene)", () => {
    const ko = prompts(LANGUAGES.ko);
    const leftovers = Object.entries(ko).flatMap(([k, v]) => v.split("\n").filter((l) => /[аА]нглийск/.test(l)).map((l) => `${k}: ${l}`));
    expect(leftovers).toEqual([
      "mnemonic: - link: связь со знакомым корейским словом или заимствованием из английского (컴퓨터 ← computer);",
      expect.stringMatching(/^image: Описание сцены: по-английски/),
    ]);
    expect(ko.system).toContain("учить корейский");
    expect(ko.enrich).toContain("Revised Romanization");
    expect(ko.check).toContain("частицы");
    expect(ko.talkReply).toContain("Отвечай только по-корейски");
  });

  it("a Russian word means «find the equivalent» only when it has no letters of the language", () => {
    expect(e.isRussian("зуб")).toBe(true);
    expect(e.isRussian("зуб", LANGUAGES.ko)).toBe(true);
    expect(e.isRussian("이 зуб", LANGUAGES.ko)).toBe(false);
    expect(e.isRussian("tooth — зуб")).toBe(false);
  });
});
