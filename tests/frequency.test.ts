import { describe, expect, it, vi } from "vitest";
import type { FrequencySource } from "../src/frequency/frequency";
import { applyFrequency, levelByZipf, singleWord } from "../src/services/usefulness";

const zipfs: Record<string, number> = { flood: 4.34, melt: 3.96, feign: 2.58, arse: 3.57, ensure: 4.6 };
const source: FrequencySource = { zipf: async (terms) => new Map(terms.map((t) => [t, zipfs[t] ?? 0])) };

describe("usefulness of a single word comes from its frequency", () => {
  it("is the same however the word was added", async () => {
    const alone = await applyFrequency([{ term: "flood", usefulness: 3, usefulnessNote: "частое в новостях" }], source);
    const inList = await applyFrequency([{ term: "Flood", usefulness: 2, usefulnessNote: "встречается" }], source);
    expect(alone[0]).toMatchObject({ usefulness: 3, usefulnessNote: "частое в новостях" });
    expect(inList[0]).toMatchObject({ usefulness: 3, usefulnessNote: "очень частое слово" });
  });

  it("uses fixed thresholds, keeps rude/dated/show jargon optional, leaves phrases to the model", async () => {
    expect([4.34, 3.96, 3.3, 2.58].map(levelByZipf)).toEqual([3, 2, 2, 1]);
    const rated = await applyFrequency(
      [
        { term: "to ensure", usefulness: 2 },
        { term: "feign", usefulness: 2 },
        { term: "arse", usefulness: 2, niche: true },
        { term: "nail it", usefulness: 3 },
        { term: "zzyzx", usefulness: 2 },
      ],
      source,
    );
    expect(rated.map((r) => r.usefulness)).toEqual([3, 1, 1, 3, 2]);
    expect(singleWord("step in")).toBeUndefined();
  });

  it("falls back to the model when frequencies are unavailable", async () => {
    const broken: FrequencySource = { zipf: vi.fn(async () => Promise.reject(new Error("no python"))) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await applyFrequency([{ term: "flood", usefulness: 2 }], broken))[0].usefulness).toBe(2);
    expect((await applyFrequency([{ term: "flood", usefulness: 2 }], undefined))[0].usefulness).toBe(2);
  });
});

describe("hyphenated words", () => {
  it("are phrases for frequency purposes", () => {
    expect(singleWord("over-deliver")).toBeUndefined();
    expect(singleWord("don't")).toBe("don't");
  });
});
