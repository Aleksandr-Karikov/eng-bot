import { describe, expect, it, vi } from "vitest";
import { ClozeGenerator } from "../src/services/cloze-generator";
import { RetryLater, RETRY_MS } from "../src/services/retry-later";
import { testDb, T0 } from "./helpers";

describe("not asking Claude again right after a failure", () => {
  it("blocks for a while, then lets it try again", () => {
    let now = 0;
    const r = new RetryLater(() => now);
    r.failed(1);
    expect(r.blocked(1)).toBe(true);
    now = RETRY_MS + 1;
    expect(r.blocked(1)).toBe(false);
  });

  it("a failed cloze generation is not repeated on every card show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cloze = vi.fn(async () => Promise.reject(new Error("timeout")));
    const gen = new ClozeGenerator(testDb(), { cloze } as never, () => T0);
    await gen.ensure({ id: 1, term: "bank", translation: "берег" });
    await gen.ensure({ id: 1, term: "bank", translation: "берег" });
    expect(cloze).toHaveBeenCalledTimes(1);
  });
});
