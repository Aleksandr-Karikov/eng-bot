import { describe, expect, it } from "vitest";
import { slowApiCallLogger } from "../src/bot/api-errors";

describe("slowApiCallLogger", () => {
  it("logs Telegram calls slower than the threshold with method and duration", async () => {
    const logs: string[] = [];
    const transformer = slowApiCallLogger(5, (line) => logs.push(line));
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, result: true } as never;
    };
    const fast = async () => ({ ok: true, result: true }) as never;
    await transformer(slow as never, "editMessageText", {} as never);
    await transformer(fast as never, "answerCallbackQuery", {} as never);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/editMessageText took \d+ ms/);
  });
});
