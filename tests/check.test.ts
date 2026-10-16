import { describe, expect, it, vi } from "vitest";
import { checkText } from "../src/bot/texts";
import { buildCheckPrompt, parseCheck, type CheckResult } from "../src/llm/enricher";
import { botHarness } from "./bot-harness";

const result: CheckResult = {
  corrected: "He **goes** to work <3",
  fixes: [{ wrong: "he go", right: "he goes", why: "в третьем лице добавляется -s" }],
  natural: "He's off to work",
};

describe("parseCheck", () => {
  it("parses a fenced JSON answer and defaults missing fields", () => {
    expect(parseCheck("```json\n" + JSON.stringify(result) + "\n```")).toEqual(result);
    expect(parseCheck(JSON.stringify({ corrected: "All good" }))).toEqual({ corrected: "All good", fixes: [], natural: "" });
  });

  it("throws on garbage", () => {
    expect(() => parseCheck("hmm")).toThrow();
  });

  it("puts the text into the prompt", () => {
    expect(buildCheckPrompt("he go to work")).toContain("he go to work");
  });
});

describe("checkText", () => {
  it("shows corrected text with bold changes, fixes and a more natural option, escaping HTML", () => {
    const text = checkText(result);
    expect(text).toContain("He <b>goes</b> to work &lt;3");
    expect(text).toContain("<s>he go</s> → <b>he goes</b> — в третьем лице добавляется -s");
    expect(text).toContain("He's off to work");
  });

  it("says there are no mistakes, optionally with a more natural option", () => {
    expect(checkText({ corrected: "Fine", fixes: [], natural: "" })).toBe("👍 Ошибок нет");
    expect(checkText({ corrected: "Fine", fixes: [], natural: "All good" })).toContain("👍 Ошибок нет");
    expect(checkText({ corrected: "Fine", fixes: [], natural: "All good" })).toContain("All good");
  });
});

describe("/check", () => {
  it("checks the replied-to message and answers to it", async () => {
    const check = vi.fn(async () => result);
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "", explanation: "", example: "" }),
        extract: async () => [],
        check,
      },
    });
    await h.bot.handleUpdate(h.replyTo(100, "/check", { messageId: 555, fromId: 200, text: "he go to work" }));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("<b>goes</b>"))).toBe(true));
    expect(check).toHaveBeenCalledWith("he go to work", []);
    const answer = h.calls.find((c) => c.method === "sendMessage" && String(c.payload.text).includes("<b>goes</b>"))!;
    expect(answer.payload.reply_parameters).toMatchObject({ message_id: 555 });
  });

  it("checks inline text and explains usage when there is nothing to check", async () => {
    const check = vi.fn(async () => result);
    const h = botHarness({ enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], check } });
    await h.bot.handleUpdate(h.message(100, "/check"));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("Ответь"))).toBe(true));
    expect(check).not.toHaveBeenCalled();
    await h.bot.handleUpdate(h.message(100, "/check he go to work"));
    await vi.waitFor(() => expect(check).toHaveBeenCalledWith("he go to work", []));
  });

  it("reports when the check could not be done", async () => {
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "", explanation: "", example: "" }),
        extract: async () => [],
        check: async () => {
          throw new Error("timeout");
        },
      },
    });
    await h.bot.handleUpdate(h.message(100, "/check he go"));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("Не получилось проверить"))).toBe(true));
  });

  it("in a group, explains that messages the bot never saw cannot be checked", async () => {
    const check = vi.fn(async () => result);
    const h = botHarness({ enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], check } });
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/check"));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("не вижу"))).toBe(true));
    expect(check).not.toHaveBeenCalled();
  });
});
