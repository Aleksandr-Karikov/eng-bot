import { describe, expect, it } from "vitest";
import { reverseCardText, reverseHint } from "../src/bot/texts";
import { ALL_PARTS } from "../src/services/card-view";

const discretion = {
  term: "discretion",
  translation: "осмотрительность, благоразумие, усмотрение",
  explanation: "Способность вести себя осторожно и тактично, особенно в щекотливых ситуациях",
  example: "Use your discretion.",
  mnemonic: "",
  transcriptionUk: "",
  transcriptionUs: "",
  context: "",
  usefulness: null,
};

describe("RU → EN meaning hint (bug #10)", () => {
  it("shows the Russian explanation so synonyms with the same translation are told apart", () => {
    expect(reverseHint(discretion)).toBe(discretion.explanation);
    const text = reverseCardText(discretion as never, ALL_PARTS);
    const [front] = text.split("<tg-spoiler>");
    expect(front).toContain("<i>Способность вести себя осторожно и тактично");
  });

  it("is hidden when the explanation gives the word away", () => {
    expect(reverseHint({ term: "prudent", explanation: "От prudence — осторожный" })).toBe("");
    expect(reverseHint({ term: "Your wish is my command", explanation: "Как в command — приказ" })).toBe("");
    expect(reverseHint({ term: "beset by", explanation: "постоянно страдает" })).toBe("постоянно страдает");
    expect(reverseHint({ term: "x", explanation: "" })).toBe("");
  });

  it("follows the card settings: no explanation — no hint", () => {
    const text = reverseCardText(discretion as never, { ...ALL_PARTS, explanation: false });
    expect(text).not.toContain("Способность");
  });
});
