import { describe, expect, it } from "vitest";
import { listBugs } from "../src/services/bugs";
import { makeUser } from "./helpers";
import { botHarness, buttonData } from "./bot-harness";

describe("🐞 /bug", () => {
  it("saves the description with what was around: the bot's messages with buttons and what the person did", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎯 Упражнения")));
    await h.bot.handleUpdate(h.message(100, "/bug кнопки странно подписаны"));
    expect(String(h.calls.at(-1)?.payload.text)).toMatch(/Записал, баг #\d+/);
    const [bug] = await listBugs(h.db);
    expect(bug.description).toBe("кнопки странно подписаны");
    const lines = bug.context.transcript.map((e) => `${e.from}: ${e.text}`);
    expect(lines[0]).toBe("user: /settings");
    expect(lines.some((l) => l.startsWith("bot: ⚙️ Настройки") && l.includes("[кнопки: ⏰ Напоминания | 🎯 Упражнения | 🃏 Карточка]"))).toBe(true);
    expect(lines.some((l) => l === "user: [нажал кнопку ss:modes]")).toBe(true);
    expect(lines.some((l) => l.includes("/bug"))).toBe(false);
  });

  it("as a reply keeps the replied message, and asks for a description otherwise", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/bug"));
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Опиши, что пошло не так");
    await h.bot.handleUpdate(h.replyTo(100, "/bug", { messageId: 9, fromId: 1, text: "❌ Our plans on the weather" }));
    const [bug] = await listBugs(h.db);
    expect(bug.context.replied).toBe("❌ Our plans on the weather");
  });
});
