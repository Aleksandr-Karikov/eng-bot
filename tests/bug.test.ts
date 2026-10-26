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
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Напиши после команды, что пошло не так");
    await h.bot.handleUpdate(h.replyTo(100, "/bug", { messageId: 9, fromId: 1, text: "❌ Our plans on the weather" }));
    const [bug] = await listBugs(h.db);
    expect(bug.context.replied).toBe("❌ Our plans on the weather");
  });
});

describe("🐞 bug notices", () => {
  it("a new bug reaches the admin with who, where and what; the admin's own bug in DM doesn't", async () => {
    const h = botHarness({ adminTelegramId: 999 });
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/bug звук не играет"));
    const notice = h.calls.find((c) => c.method === "sendMessage" && c.payload.chat_id === 999);
    expect(String(notice?.payload.text)).toMatch(/Новый баг #\d+.*в личке[\s\S]*звук не играет/);

    await makeUser(h.db, 999);
    const before = h.calls.length;
    await h.bot.handleUpdate(h.message(999, "/bug свой баг"));
    expect(h.calls.slice(before).filter((c) => c.payload.chat_id === 999 && String(c.payload.text).includes("Новый баг"))).toEqual([]);
  });

  it("closing a bug tells the author what they wrote and what was done", async () => {
    const { resolveBug, bugResolvedText } = await import("../src/services/bugs");
    const h = botHarness();
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/bug кнопка <Дальше> не жмётся"));
    const [bug] = await listBugs(h.db);
    const r = await resolveBug(h.db, { id: bug.id, status: "fixed", resolution: "Починил кнопку", now: new Date() });
    expect(r.author.telegramId).toBe(100);
    const text = bugResolvedText(r.bug);
    expect(text).toContain(`✅ <b>Баг #${bug.id} исправлен</b>`);
    expect(text).toContain("кнопка &lt;Дальше&gt; не жмётся");
    expect(text).toContain("Починил кнопку");
    expect(await listBugs(h.db)).toEqual([]);
    expect(bugResolvedText({ ...r.bug, status: "wontfix" })).toContain("ℹ️ <b>По багу");
  });
});
