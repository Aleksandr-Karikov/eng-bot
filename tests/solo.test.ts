import { describe, expect, it, vi } from "vitest";
import { rooms } from "../src/db/schema";
import { getUser } from "../src/services/users";
import { botHarness, buttonData, lastButtons } from "./bot-harness";

describe("👤 alone, without rooms", () => {
  it("a new person can /add right away — the word goes to their own «Мои слова»", async () => {
    const h = botHarness();
    await h.bot.handleUpdate(h.message(100, "/start"));
    const [room] = await h.db.select().from(rooms);
    expect(room).toMatchObject({ name: "Мои слова", personalOf: 1 });
    expect((await getUser(h.db, 1))!.currentRoomId).toBe(room.id);

    await h.bot.handleUpdate(h.message(100, "/add bank"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "➕ Добавить")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Добавить")));
    expect(h.calls.some((c) => String(c.payload.text).startsWith("✅ Добавлено"))).toBe(true);
    expect(h.calls.some((c) => String(c.payload.text).includes("Сначала создай комнату"))).toBe(false);
  });

  it("the personal dictionary has no invite link — friends go to a shared room", async () => {
    const h = botHarness();
    await h.bot.handleUpdate(h.message(100, "/room"));
    const labels = lastButtons(h.calls).map((b) => b.text);
    expect(labels).toContain("➕ Комната для друзей");
    expect(labels).not.toContain("🔗 Пригласить");
  });
});
