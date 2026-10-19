import { describe, expect, it, vi } from "vitest";
import type { FrequencySource } from "../src/frequency/frequency";
import { parseEnrichment } from "../src/llm/enricher";
import { baseForms, levelByZipf, rateUsefulness, scoreUsefulness, singleWord } from "../src/services/usefulness";

const zipfs: Record<string, number> = { flood: 4.34, melt: 3.96, feign: 2.58, arse: 3.57, ensure: 4.6, divine: 4.3 };
const source: FrequencySource = { zipf: async (terms) => new Map(terms.map((t) => [t, zipfs[t] ?? 0])) };

describe("usefulness by rules", () => {
  it("a single word: frequency is the base, the same however the word was added", async () => {
    const [alone] = await rateUsefulness([{ term: "flood", sense: "main" as const, register: "neutral" as const }], source);
    const [inList] = await rateUsefulness([{ term: "Flood" }], source);
    expect(alone).toMatchObject({ usefulness: 3, usefulnessNote: "частое слово" });
    expect(inList).toMatchObject({ usefulness: 3 });
    expect([4.34, 3.96, 3.3, 2.58].map(levelByZipf)).toEqual([3, 2, 2, 1]);
  });

  it("a rare sense of a frequent word is optional; a secondary one is at most 🟡", () => {
    expect(scoreUsefulness({ term: "divine", sense: "rare" }, 4.3)).toEqual({ usefulness: 1, usefulnessNote: "частое слово · но это значение редкое" });
    expect(scoreUsefulness({ term: "flood", sense: "secondary" }, 4.34)?.usefulness).toBe(2);
  });

  it("rude, dated and jargon are optional; bookish is at most 🟡; informal is just noted", () => {
    expect(scoreUsefulness({ term: "arse", register: "rude" }, 3.57)).toEqual({ usefulness: 1, usefulnessNote: "встречается · грубое" });
    expect(scoreUsefulness({ term: "ensure", register: "formal" }, 4.6)?.usefulness).toBe(2);
    expect(scoreUsefulness({ term: "flood", register: "informal" }, 4.34)).toEqual({ usefulness: 3, usefulnessNote: "частое слово · разговорное" });
  });

  it("phrases use the model's bucket; without any data a word stays unrated", () => {
    expect(scoreUsefulness({ term: "nail it", phraseFrequency: "common" }, undefined)).toEqual({ usefulness: 3, usefulnessNote: "частое выражение" });
    expect(scoreUsefulness({ term: "keep plates spinning", phraseFrequency: "occasional", register: "informal" }, undefined)?.usefulness).toBe(2);
    expect(scoreUsefulness({ term: "zzyzx" }, 0)).toBeUndefined();
    expect(singleWord("over-deliver")).toBeUndefined();
    expect(singleWord("to ensure")).toBe("ensure");
  });

  it("the model answers questions with options; unknown answers are ignored", () => {
    const e = parseEnrichment(JSON.stringify({ translation: "x", sense: "Rare", register: "whatever", phrase_frequency: "" }));
    expect(e).toMatchObject({ sense: "rare", register: undefined, phraseFrequency: undefined });
  });

  it("a phrase «word + particle» is never more useful than its word", () => {
    expect(scoreUsefulness({ term: "beset by", phraseFrequency: "occasional" }, undefined, 3.08)).toEqual({ usefulness: 1, usefulnessNote: "само «beset» — редкое слово" });
    expect(scoreUsefulness({ term: "draw up", phraseFrequency: "common" }, undefined, 5.1)?.usefulness).toBe(3);
  });

  it("takes the most frequent form of the phrase's word (wiped out → wipe)", async () => {
    expect(baseForms("wiped")).toEqual(expect.arrayContaining(["wiped", "wipe"]));
    expect(baseForms("running")).toEqual(expect.arrayContaining(["run"]));
    expect(baseForms("drawing")).toEqual(expect.arrayContaining(["draw"]));
    const forms: FrequencySource = { zipf: async (terms) => new Map(terms.map((t) => [t, t === "wipe" ? 4.4 : t === "wiped" ? 3.5 : 0])) };
    const [r] = await rateUsefulness([{ term: "wiped out", phraseFrequency: "common" as const, usefulness: undefined as number | undefined }], forms);
    expect(r.usefulness).toBe(3);
  });

  it("falls back gracefully when frequencies are unavailable", async () => {
    const broken: FrequencySource = { zipf: vi.fn(async () => Promise.reject(new Error("no python"))) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [r] = await rateUsefulness([{ term: "flood", usefulness: 2 }], broken);
    expect(r.usefulness).toBe(2);
  });
});
