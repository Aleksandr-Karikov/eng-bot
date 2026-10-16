import { describe, expect, it } from "vitest";
import { buildDrillPrompt, parseDrill } from "../src/llm/tutor";
import { parseCheck } from "../src/llm/enricher";
import { clearMistakes, mistakeProfile, recordMistakes, recentMistakes } from "../src/services/mistakes";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

const fix = (category: string, wrong = "w", right = "r") => ({ wrong, right, why: "", category });

describe("mistakes", () => {
  it("records fixes with a category and keeps the latest 30 from the last 60 days", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    await recordMistakes(db, alice.id, [fix("артикли", "go to shop", "go to the shop")], at(-90 * DAY));
    for (let i = 0; i < 35; i++) await recordMistakes(db, alice.id, [fix(i < 20 ? "времена" : "предлоги")], at(i * 60_000));
    const recent = await recentMistakes(db, alice.id, at(DAY));
    expect(recent).toHaveLength(30);
    expect(recent.some((m) => m.category === "артикли")).toBe(false);
    await recordMistakes(db, alice.id, [{ wrong: "x", right: "y", why: "" }], T0);
    expect((await recentMistakes(db, alice.id, at(DAY))).length).toBe(30);
  });

  it("builds a profile: categories by frequency with a couple of examples", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    await recordMistakes(db, alice.id, [fix("времена", "I go yesterday", "I went yesterday"), fix("артикли", "go to shop", "go to the shop")], T0);
    await recordMistakes(db, alice.id, [fix("времена", "he come tomorrow", "he is coming tomorrow")], at(60_000));
    const profile = mistakeProfile(await recentMistakes(db, alice.id, at(DAY)));
    expect(profile.total).toBe(3);
    expect(profile.categories.map((c) => [c.category, c.count])).toEqual([["времена", 2], ["артикли", 1]]);
    expect(profile.categories[0].examples[0]).toEqual({ wrong: "he come tomorrow", right: "he is coming tomorrow" });
    expect(profile.text).toContain("времена ×2");
    expect(profile.text).toContain("he come tomorrow → he is coming tomorrow");
  });

  it("clears a user's mistakes only", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    await recordMistakes(db, alice.id, [fix("времена")], T0);
    await recordMistakes(db, bob.id, [fix("времена")], T0);
    await clearMistakes(db, alice.id);
    expect(await recentMistakes(db, alice.id, at(DAY))).toHaveLength(0);
    expect(await recentMistakes(db, bob.id, at(DAY))).toHaveLength(1);
  });
});

describe("check categories and drill parsing", () => {
  it("keeps the category of each fix from /check", () => {
    const r = parseCheck(JSON.stringify({ corrected: "x", fixes: [{ wrong: "a", right: "b", why: "c", category: "артикли" }, { wrong: "d", right: "e" }] }));
    expect(r.fixes.map((f) => f.category)).toEqual(["артикли", ""]);
  });

  it("parses drill questions and drops broken ones", () => {
    const good = { question: "Tomorrow I ___ my mom.", options: ["visit", "am visiting", "visited"], correct: 1, explanation: "планы", category: "времена" };
    const raw = JSON.stringify([good, { ...good, correct: 5 }, { ...good, options: ["one"] }, { ...good, question: "no gap" }]);
    expect(parseDrill("```json\n" + raw + "\n```")).toEqual([good]);
  });

  it("puts the profile and the count into the prompt", () => {
    const p = buildDrillPrompt("времена ×2: he come → he is coming", 3);
    expect(p).toContain("he come → he is coming");
    expect(p).toContain("3");
  });
});
