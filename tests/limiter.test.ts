import { describe, expect, it } from "vitest";
import { Limiter } from "../src/llm/limiter";

describe("at most N Claude processes at once", () => {
  it("queues the rest and lets urgent jobs go before background ones", async () => {
    const limiter = new Limiter(1);
    const order: string[] = [];
    let release!: () => void;
    const first = limiter.run(true, () => new Promise<void>((r) => (release = () => { order.push("first"); r(); })));
    const background = limiter.run(false, async () => void order.push("background"));
    const urgent = limiter.run(true, async () => void order.push("urgent"));
    expect(limiter.queued).toBe(2);
    release();
    await Promise.all([first, background, urgent]);
    expect(order).toEqual(["first", "urgent", "background"]);
  });

  it("frees the slot when a job fails", async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(true, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(true, async () => "ok")).resolves.toBe("ok");
  });
});
