import { describe, expect, it } from "vitest";
import { drillResultText, fillGap } from "../src/bot/texts";

describe("filling a gap never repeats a word", () => {
  it("drops the noun the option repeated", () => {
    expect(fillGap("We need ___ gold for this ring.", "gold")).toBe("We need <b>gold</b> for this ring.");
    expect(fillGap("I need ___ advice about choosing a university.", "an advice")).toBe("I need <b>an advice</b> about choosing a university.");
    expect(fillGap("She lives ___ London now.", "in London")).toBe("She lives <b>in London</b> now.");
  });

  it("drops a word repeated before the gap and keeps punctuation", () => {
    expect(fillGap("It depends on ___ weather.", "on the")).toBe("It depends <b>on the</b> weather.");
    expect(fillGap("Pass me ___ salt, please.", "the salt")).toBe("Pass me <b>the salt</b>, please.");
  });

  it("leaves normal answers alone, «—» included", () => {
    expect(fillGap("We need ___ gold.", "—")).toBe("We need <b>—</b> gold.");
    expect(fillGap("I ___ there yesterday.", "went")).toBe("I <b>went</b> there yesterday.");
  });

  it("is used in the drill result", () => {
    const q = { question: "We need ___ gold for this ring.", options: ["the gold", "a gold", "gold"], correct: 2, explanation: "", category: "артикли" };
    expect(drillResultText(q, 2)).toContain("We need <b>gold</b> for this ring.");
  });
});

describe("drill questions must contain what the rule is about", async () => {
  const { completeQuestion, parseDrill } = await import("../src/llm/tutor");
  const broken = {
    question: "Our plans ___ the weather, so we will decide tomorrow.",
    options: ["of", "on", "from"],
    correct: 1,
    explanation: "Устойчивое сочетание: depend on (зависеть от). «Depend of» и «depend from» не употребляются.",
    category: "предлоги",
  };

  it("drops a question whose sentence lost the verb of the rule", () => {
    expect(completeQuestion(broken)).toBe(false);
    expect(completeQuestion({ ...broken, question: "Our plans depend ___ the weather, so we will decide tomorrow." })).toBe(true);
    expect(completeQuestion({ ...broken, question: "It all depends ___ the weather." })).toBe(true);
    expect(parseDrill(JSON.stringify([broken]))).toEqual([]);
  });

  it("keeps ordinary questions", () => {
    expect(completeQuestion({ question: "We need ___ gold.", options: ["the", "a", "—"], correct: 2, explanation: "Gold — неисчисляемое, we use the zero article." })).toBe(true);
    expect(completeQuestion({ question: "I ___ there yesterday.", options: ["go", "went"], correct: 1, explanation: "С yesterday — Past Simple: went." })).toBe(true);
  });
});
