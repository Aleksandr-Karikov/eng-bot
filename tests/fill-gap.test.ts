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
