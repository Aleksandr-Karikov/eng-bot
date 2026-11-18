import { describe, expect, it } from "vitest";
import { buildPrompt, parseEnrichment, parseExampleTranslation, parseExtraction } from "../src/llm/enricher";

const ok = { translation: "счастливая случайность", explanation: "Удачное открытие.", example: "It was pure serendipity." };

describe("parseEnrichment", () => {
  it("parses plain JSON", () => {
    expect(parseEnrichment(JSON.stringify(ok))).toMatchObject(ok);
  });

  it("parses JSON wrapped in a code fence with chatter", () => {
    expect(parseEnrichment("Вот ответ:\n```json\n" + JSON.stringify(ok) + "\n```")).toMatchObject(ok);
  });

  it("throws on garbage and on missing translation", () => {
    expect(() => parseEnrichment("не знаю")).toThrow();
    expect(() => parseEnrichment(JSON.stringify({ ...ok, translation: "" }))).toThrow();
    expect(() => parseEnrichment(JSON.stringify({ ...ok, translation: "steady-handed experts" }))).toThrow();
  });
});

it("drops extracted words whose translation is still English", () => {
  expect(parseExtraction(JSON.stringify([
    { term: "steady-handed", ...ok, translation: "steady-handed experts" },
    { term: "bank", ...ok, translation: "берег" },
  ])).map((w) => w.term)).toEqual(["bank"]);
});

describe("parseExampleTranslation", () => {
  it("takes the translation out of the JSON the system prompt asks for, fence and quotes included", () => {
    expect(parseExampleTranslation('```json\n{"translation": "Мы сидели на берегу реки."}\n```')).toBe("Мы сидели на берегу реки.");
    expect(parseExampleTranslation('{"translation": "«Мы сидели на берегу реки.»"}')).toBe("Мы сидели на берегу реки.");
  });

  it("accepts a bare sentence from a model that ignored the JSON rule", () => {
    expect(parseExampleTranslation("  Мы сидели на берегу реки.  ")).toBe("Мы сидели на берегу реки.");
  });
});

describe("buildPrompt", () => {
  it("includes the term and the hint", () => {
    const p = buildPrompt("bank", "берег");
    expect(p).toContain('"bank"');
    expect(p).toContain('"берег"');
  });
});
