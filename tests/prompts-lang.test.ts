import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as e from "../src/llm/enricher";
import * as t from "../src/llm/tutor";

/**
 * Английские промпты закреплены байт в байт.
 *
 * Эталон снят до появления языков и остаётся тем же после их удаления (E23): язык у бота один, и
 * любая правка текста промпта должна быть замечена этим тестом, а не пройти незаметно.
 */
function prompts(): Record<string, string> {
  const word = { term: "take for granted", translation: "принимать как должное", explanation: "не ценить", example: "Don't take me for granted.", mnemonic: "грант" };
  const talk = { topic: "cafe", words: [{ term: "keen", translation: "увлечённый" }], lines: [{ who: "bot" as const, text: "Hi!" }, { who: "user" as const, text: "I has coffee" }] };
  const task = { ru: "Я рад", en: "I'm glad", topic: "", word: "" };
  return {
    system: e.systemPrompt(),
    enrich: e.buildPrompt("bank", undefined, undefined),
    enrichHint: e.buildPrompt("bank", "берег", "on the bank of the river"),
    enrichRu: e.buildPrompt("зуб", undefined, undefined),
    extract: e.buildExtractPrompt("Some text here."),
    extractImage: e.buildExtractImagePrompt("только идиомы"),
    readImage: e.buildReadImagePrompt(),
    check: e.buildCheckPrompt("I has a cat", [{ author: "Ann", text: "hi" }], "Bob", ["So"]),
    checkPlain: e.buildCheckPrompt("I has a cat", [], undefined, []),
    cloze: t.buildClozePrompt("keen", "увлечённый"),
    judge: t.buildJudgePrompt({ sentence: "He is ___ on it.", expected: "keen", term: "keen", translation: "увлечённый", answer: "kean" }),
    sentence: t.buildSentencePrompt({ term: "keen", translation: "увлечённый", explanation: "", answer: "I am keen." }),
    untangle: t.buildUntanglePrompt(word),
    translationTask: t.buildTranslationTaskPrompt({ topics: [{ category: "артикли", examples: [{ wrong: "a apple", right: "an apple" }] }], words: [{ term: "keen", translation: "увлечённый" }], avoid: ["Я рад"] }),
    translationReview: t.buildTranslationReviewPrompt({ task, answer: "I glad" }),
    collocations: t.buildCollocationsPrompt("keen", "увлечённый"),
    say: t.buildSayPrompt("я соскучился"),
    talkReply: t.buildTalkReplyPrompt(talk),
    talkReview: t.buildTalkReviewPrompt(talk),
    story: t.buildStoryPrompt([{ term: "keen", translation: "увлечённый" }]),
    drill: t.buildDrillPrompt("артикли ×3: a apple → an apple", 3, ["old q"]),
    mnemonic: t.buildMnemonicPrompt([{ term: "keen", translation: "увлечённый" }, { term: "bank", translation: "", instead: "банка" }]),
    image: t.buildImagePromptPrompt({ ...word, wish: "кот" }),
  };
}

describe("промпты английского", () => {
  const before = JSON.parse(readFileSync(new URL("./fixtures/prompts-en.json", import.meta.url), "utf8"));

  it("текст промптов не изменился после удаления языков", () => {
    expect(prompts()).toEqual(before);
  });

  it("русское слово означает «подбери эквивалент»", () => {
    expect(e.isRussian("зуб")).toBe(true);
    expect(e.isRussian("tooth — зуб")).toBe(false);
  });
});
