import { describe, expect, it, vi } from "vitest";
import { ChatHistory } from "../src/bot/history";
import { buildCheckPrompt, type CheckResult } from "../src/llm/enricher";
import { botHarness } from "./bot-harness";

const ok: CheckResult = { corrected: "x", fixes: [], natural: "" };
const msg = (messageId: number, date: number, text = `m${messageId}`) => ({ messageId, author: "A", text, date });

describe("ChatHistory", () => {
  it("returns up to N recent messages before the target, oldest first, within the age window", () => {
    const h = new ChatHistory(5);
    for (const m of [msg(1, 0), msg(2, 100), msg(3, 1000), msg(4, 1100), msg(5, 1150), msg(6, 1200)]) h.record(-1, m);
    expect(h.before(-1, { messageId: 6, date: 1200 }, 3, 900).map((m) => m.messageId)).toEqual([3, 4, 5]);
    expect(h.before(-1, { messageId: 4, date: 1100 }, 3, 900).map((m) => m.messageId)).toEqual([3]);
    // Буфер ограничен: самые старые вытесняются.
    expect(h.before(-1, { messageId: 99, date: 1200 }, 10, 99999).map((m) => m.messageId)).toEqual([2, 3, 4, 5, 6]);
    expect(h.before(-2, { messageId: 6, date: 1200 }, 3, 900)).toEqual([]);
  });
});

describe("buildCheckPrompt", () => {
  it("passes previous messages as context to explain, but not to correct", () => {
    const p = buildCheckPrompt("I go there yesterday", [{ author: "Саша", text: "What did you do yesterday?" }]);
    expect(p).toContain("Саша: What did you do yesterday?");
    expect(p).toContain("I go there yesterday");
    expect(p).toMatch(/не исправляй/i);
  });
});

describe("/check with context", () => {
  it("sends up to six messages before the replied one, with authors and the checked message's author", async () => {
    const check = vi.fn(async () => ok);
    const h = botHarness({ enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], check } });
    const chat = -700;
    await h.bot.handleUpdate(h.groupMessage(200, chat, "Morning!"));
    await h.bot.handleUpdate(h.groupMessage(300, chat, "What did you do yesterday?"));
    await h.bot.handleUpdate(h.groupMessage(200, chat, "/stats"));
    await h.bot.handleUpdate(h.groupMessage(300, chat, "Tell us"));
    await h.bot.handleUpdate(h.groupMessage(200, chat, "Hi all"));
    const target = h.groupMessage(200, chat, "I go to cinema yesterday");
    await h.bot.handleUpdate(target);

    await h.bot.handleUpdate(
      h.groupReplyTo(100, chat, "/check", { messageId: target.message!.message_id, fromId: 200, text: "I go to cinema yesterday" }),
    );
    await vi.waitFor(() => expect(check).toHaveBeenCalled());
    expect(check).toHaveBeenCalledWith(
      "I go to cinema yesterday",
      [
        { author: "User200", text: "Morning!" },
        { author: "User300", text: "What did you do yesterday?" },
        { author: "User300", text: "Tell us" },
        { author: "User200", text: "Hi all" },
      ],
      "User200",
      ["Hi all"],
    );
  });
});
