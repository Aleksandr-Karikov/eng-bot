import { describe, expect, it } from "vitest";
import { updateUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { makeUser } from "./helpers";

/**
 * `/settings` собирает текст с HTML-тегами (`<b>Озвучка карточек…</b>`), но отправлялся без
 * `parse_mode: "HTML"` — Telegram показывал теги буквально, и человек читал «<b>Озвучка</b>» (E31).
 */
describe("настройки отправляются с разметкой (E31)", () => {
  it("главный экран /settings идёт с parse_mode HTML", async () => {
    const h = botHarness();
    await updateUser(h.db, (await makeUser(h.db, 100, "A")).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/settings"));
    const sent = h.calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(sent?.payload.parse_mode).toBe("HTML");
  });

  it("экраны «Озвучка» и «Напоминание» тоже с разметкой", async () => {
    const h = botHarness();
    await updateUser(h.db, (await makeUser(h.db, 200, "B")).id, { canDm: true });
    await h.bot.handleUpdate(h.message(200, "/settings"));
    // Кнопка экрана озвучки: её текст содержит «Озвучка».
    const kb = h.calls.filter((c) => c.payload.reply_markup).at(-1)?.payload.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    const voice = kb.inline_keyboard.flat().find((b) => b.text.includes("Озвучка"));
    expect(voice).toBeDefined();
    await h.bot.handleUpdate(h.callback(200, voice!.callback_data));
    const edited = h.calls.filter((c) => c.method === "editMessageText").at(-1);
    expect(edited?.payload.parse_mode).toBe("HTML");
  });
});
