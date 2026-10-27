import { describe, expect, it, vi } from "vitest";
import { HttpError } from "grammy";
import { retryNetworkErrors } from "../src/bot/api-errors";
import { redactLogs } from "../src/log-redact";

const ok = { ok: true, result: true } as never;
const networkError = () => new HttpError("Network request for 'sendMessage' failed!", new Error("socket hang up"));

describe("flaky network to Telegram", () => {
  it("retries a dropped request instead of failing the update", async () => {
    const prev = vi.fn().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok);
    const wait = vi.fn(async () => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(retryNetworkErrors([1, 2, 3], wait)(prev, "sendMessage", { chat_id: 1, text: "x" } as never)).resolves.toBe(ok);
    expect(prev).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1], [2]]);
  });

  it("gives up after the last retry and never retries Telegram's own errors or long polling", async () => {
    const wait = async () => {};
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const always = vi.fn().mockRejectedValue(networkError());
    await expect(retryNetworkErrors([1, 1], wait)(always, "sendMessage", {} as never)).rejects.toBeInstanceOf(HttpError);
    expect(always).toHaveBeenCalledTimes(3);
    const polling = vi.fn().mockRejectedValue(networkError());
    await expect(retryNetworkErrors([1], wait)(polling, "getUpdates", {} as never)).rejects.toBeInstanceOf(HttpError);
    expect(polling).toHaveBeenCalledTimes(1);
    const other = vi.fn().mockRejectedValue(new Error("bug"));
    await expect(retryNetworkErrors([1], wait)(other, "sendMessage", {} as never)).rejects.toThrow("bug");
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe("logs", () => {
  const collector = () => {
    const lines: string[] = [];
    const target = { log: (...a: unknown[]) => lines.push(a.join(" ")), warn: (...a: unknown[]) => lines.push(a.join(" ")), error: (...a: unknown[]) => lines.push(a.join(" ")) };
    return { lines, target };
  };

  it("never contain the bot token", () => {
    const { lines, target } = collector();
    redactLogs("123:SECRET", "<BOT_TOKEN>", target as never);
    target.error("Bot error", new Error("request to https://api.telegram.org/bot123:SECRET/sendMessage failed"));
    target.warn("plain bot123:SECRET");
    expect(lines.join("\n")).not.toContain("SECRET");
    expect(lines[0]).toContain("bot<BOT_TOKEN>/sendMessage");
  });

  it("never contain the OpenRouter key, and say which secret was cut", () => {
    // Тело ошибки OpenRouter (например, 401) пишется в лог как есть и может содержать ключ.
    const { lines, target } = collector();
    redactLogs("sk-or-v1-SECRET", "<OPEN_ROUTER_API_KEY>", target as never);
    target.error("OpenRouter failed: 401 invalid api key sk-or-v1-SECRET");
    expect(lines.join("\n")).not.toContain("SECRET");
    expect(lines[0]).toContain("<OPEN_ROUTER_API_KEY>");
  });

  it("keeps both secrets out when there are two", () => {
    const { lines, target } = collector();
    redactLogs("123:SECRET", "<BOT_TOKEN>", target as never);
    redactLogs("sk-or-v1-OTHER", "<OPEN_ROUTER_API_KEY>", target as never);
    target.error("bot123:SECRET and sk-or-v1-OTHER together");
    expect(lines.join("\n")).not.toContain("SECRET");
    expect(lines.join("\n")).not.toContain("OTHER");
  });
});
