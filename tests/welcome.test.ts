import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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

describe("🎬 welcome video", () => {
  const video = () => {
    const path = join(mkdtempSync(join(tmpdir(), "welcome-")), "welcome.mp4");
    writeFileSync(path, "mp4");
    return path;
  };
  const methods = (h: ReturnType<typeof botHarness>) => h.calls.map((c) => c.method).filter((m) => m === "sendVideo" || m === "sendMessage");

  it("/start in DM: the video first, then the welcome text; the second time by file_id", async () => {
    const h = botHarness({ welcomeVideo: video() });
    await h.bot.handleUpdate(h.message(100, "/start"));
    await vi.waitFor(() => expect(methods(h)).toEqual(["sendVideo", "sendMessage"]));
    expect(h.calls.at(-1)?.payload.text).toBe(welcomeText());
    await h.bot.handleUpdate(h.message(101, "/start"));
    await vi.waitFor(() => expect(methods(h)).toHaveLength(4));
    const second = h.calls.filter((c) => c.method === "sendVideo")[1];
    expect(second.payload.video).toMatch(/^video-file-/);
  });

  it("no video file — only the text; a failed upload does not block the text", async () => {
    const plain = botHarness();
    await plain.bot.handleUpdate(plain.message(100, "/start"));
    await vi.waitFor(() => expect(methods(plain)).toEqual(["sendMessage"]));
    const broken = botHarness({ welcomeVideo: video(), fail: (call) => (call.method === "sendVideo" ? "Bad Request: file too big" : undefined) });
    await broken.bot.handleUpdate(broken.message(100, "/start"));
    await vi.waitFor(() => expect(broken.calls.at(-1)?.payload.text).toBe(welcomeText()));
  });
});

describe("simpler menus", () => {
  it("keeps the DM menu short and gives groups their own", async () => {
    const { GROUP_COMMANDS } = await import("../src/bot/setup");
    expect(COMMANDS.length).toBeLessThanOrEqual(13);
    expect(GROUP_COMMANDS.map((c) => c.command)).toEqual(expect.arrayContaining(["check", "duel", "link"]));
  });

  it("/settings opens on a short menu of three screens", async () => {
    const h = botHarness();
    await h.bot.handleUpdate(h.message(100, "/settings"));
    expect((h.calls.at(-1)?.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard.flat().map((b) => b.text)).toEqual([
      "⏰ Напоминания",
      "🎯 Упражнения",
      "🃏 Карточка",
    ]);
  });

  it("/mistakes leads to drill questions and the translation trainer", async () => {
    const { mistakesKeyboard } = await import("../src/bot/keyboards");
    expect(mistakesKeyboard().inline_keyboard.flat().map((b) => b.text)).toEqual(["🧠 Вопросы по ошибкам", "🇷🇺→🇬🇧 Перевод", "🗑 Сбросить"]);
  });
});
