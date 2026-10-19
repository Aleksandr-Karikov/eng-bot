import { describe, expect, it } from "vitest";
import { welcomeText } from "../src/bot/texts";
import { COMMANDS } from "../src/bot/setup";
import { botHarness } from "./bot-harness";

describe("/start and /help", () => {
  it("fits one Telegram message with balanced HTML", () => {
    const text = welcomeText();
    expect(text.length).toBeLessThan(4096);
    for (const tag of ["b", "blockquote"]) {
      const opened = text.match(new RegExp(`<${tag}[ >]`, "g"))?.length ?? 0;
      expect(opened).toBe(text.split(`</${tag}>`).length - 1);
    }
  });

  it("mentions every command from the menu", () => {
    const text = welcomeText();
    for (const { command } of COMMANDS) if (command !== "start") expect(text).toContain(`/${command}`);
  });

  it("/help shows the same text", async () => {
    const h = botHarness();
    await h.bot.handleUpdate(h.message(100, "/help"));
    expect(h.calls.at(-1)?.payload.text).toBe(welcomeText());
  });
});
