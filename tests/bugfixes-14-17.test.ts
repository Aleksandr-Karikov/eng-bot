import { describe, expect, it, vi } from "vitest";
import { reverseHint, reverseCardText, usefulnessLine } from "../src/bot/texts";
import { withLang } from "../src/lang";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import type { LlmBackend } from "../src/llm/backend";
import { parseDrillReview } from "../src/llm/tutor";
import { storedCollocations, validQuiz } from "../src/services/collocations";
import { usefulnessIcon } from "../app/src/format";

const broken = { question: "She asked me what ___ favorite book was.", options: ["you", "your", "yours"], correct: 0, explanation: "Вопрос в косвенной речи", category: "Косвенная речь" };
const good = { ...broken, correct: 1, explanation: "Your — притяжательное местоимение перед существительным." };

describe("bug #14: hidden answer is not leaked by another word form", () => {
  it("hides slay in the hint for Slain but preserves Russian explanations", () => {
    const word = { term: "Slain", translation: "убитый", explanation: "Прошедшее причастие от глагола slay: убитый в бою.", example: "" };
    expect(reverseHint(word)).toBe("");
    expect(reverseCardText(word).split("<tg-spoiler>")[0]).not.toContain("slay");
    expect(reverseHint({ ...word, explanation: "Убитый в бою." })).toBe("Убитый в бою.");
    expect(withLang("ko", () => reverseHint({ term: "갔어요", explanation: "Форма глагола 가다." }))).toBe("");
  });
});

describe("bug #15: drill questions are checked before reaching learners", () => {
  it("uses the checker model and returns only approved original questions", async () => {
    const ask = vi.fn<LlmBackend["ask"]>()
      .mockResolvedValueOnce(JSON.stringify([broken, good]))
      .mockResolvedValueOnce('{"approved":[1]}');
    const llm = new ClaudeCodeEnricher({ model: "main", checkModel: "checker", timeoutMs: 1000 }, { name: "fake", ask });
    expect(await llm.drill("Косвенная речь", 2)).toEqual([good]);
    expect(ask.mock.calls[1][2]).toBe("checker");
    expect(ask.mock.calls[1][0]).toContain("you / your");
    expect(ask.mock.calls[1][0]).toContain(broken.question);
  });

  it("does not fall back to unchecked questions on review failure", async () => {
    const ask = vi.fn<LlmBackend["ask"]>().mockResolvedValueOnce(JSON.stringify([broken])).mockRejectedValueOnce(new Error("timeout"));
    const llm = new ClaudeCodeEnricher({ model: "main", timeoutMs: 1000 }, { name: "fake", ask });
    await expect(llm.drill("Косвенная речь", 1)).rejects.toThrow("timeout");
    expect(parseDrillReview('{"approved":[1,1,99]}', [broken, good])).toEqual([good]);
    expect(() => parseDrillReview('{}', [broken])).toThrow();
  });
});

describe("bug #16: collocation answers cannot be forms of the heading", () => {
  const quiz = { question: "The opening scene really ___ me in.", options: ["pulled", "took", "caught"], correct: 0, explanation: "" };
  it("rejects pulled / pull, including old saved quizzes, but keeps the collocations", () => {
    expect(validQuiz(quiz, "pull someone in")).toBe(false);
    expect(validQuiz({ ...quiz, options: ["running", "walking"] }, "run late")).toBe(false);
    expect(validQuiz({ ...quiz, options: ["plans", "decisions"] }, "draw up")).toBe(true);
    const items = [{ phrase: "pull the reader in", translation: "увлечь читателя" }];
    expect(storedCollocations({ term: "pull someone in", collocations: JSON.stringify({ items, quiz }) })).toEqual({ items });
  });
});

describe("bug #17: missing usefulness has an explicit label", () => {
  it("does not pretend an unrated word is rare or useful", () => {
    expect(usefulnessLine({ usefulness: null })).toContain("не оценена");
    expect(usefulnessIcon(null)).toBe("❔");
    expect(usefulnessIcon(1)).toBe("⚪️");
    expect(usefulnessIcon(3)).toBe("🟢");
  });
});
