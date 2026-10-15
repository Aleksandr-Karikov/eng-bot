import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import type { ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness, type ApiCall } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const item = (term: string): ExtractedItem => ({ term, translation: `t-${term}`, explanation: "", example: "" });
const enricher = (items: ExtractedItem[]): WordEnricher => ({
  enrich: async () => ({ translation: "x", explanation: "", example: "" }),
  extract: async () => items,
});

/** Два участника комнаты: автор (100) и друг (200), оба нажали Start. */
async function room(h: ReturnType<typeof botHarness>) {
  const author = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const friend = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
  const r = await createRoom(h.db, { name: "R", createdBy: author.id, now: T0 });
  await joinRoom(h.db, { roomId: r.id, userId: friend.id, now: T0, makeCurrent: true });
  return { author, friend };
}

const lastKeyboard = (calls: ApiCall[]) => {
  const call = [...calls].reverse().find((c) => c.payload.reply_markup);
  return (call?.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
};
const button = (calls: ApiCall[], prefix: string) => lastKeyboard(calls).find((b) => b.text.startsWith(prefix))!.callback_data;
const sentTo = (calls: ApiCall[], chatId: number) =>
  calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === chatId);

describe("/text batches", () => {
  it("adds the selected words and sends friends one summary instead of a prompt per word", async () => {
    const h = botHarness({ enricher: enricher([item("serendipity"), item("take for granted"), item("hangar")]) });
    await room(h);
    await h.bot.handleUpdate(h.message(100, "/text It was pure serendipity, we took it for granted, the hangar..."));
    await vi.waitFor(() => expect(lastKeyboard(h.calls).some((b) => b.text.startsWith("✅ Добавить (3)"))).toBe(true));

    await h.bot.handleUpdate(h.callback(100, button(h.calls, "✅ hangar")));
    expect(lastKeyboard(h.calls).some((b) => b.text === "✅ Добавить (2)")).toBe(true);

    const before = sentTo(h.calls, 200).length;
    await h.bot.handleUpdate(h.callback(100, button(h.calls, "✅ Добавить")));
    await vi.waitFor(() => expect(sentTo(h.calls, 200).length).toBe(before + 1));

    const terms = (await h.db.select().from(words)).map((w) => w.term);
    expect(terms).toEqual(["serendipity", "take for granted"]);
    const summary = sentTo(h.calls, 200).at(-1)!;
    expect(summary.payload.text).toContain("2 слова");
    expect(summary.payload.reply_markup).toBeUndefined();
    expect(await h.db.select().from(cards)).toHaveLength(4);
  });

  it("reviews selected words one by one with skip", async () => {
    const h = botHarness({ enricher: enricher([item("serendipity"), item("hangar")]) });
    await room(h);
    await h.bot.handleUpdate(h.message(100, "/text serendipity, hangar"));
    await vi.waitFor(() => expect(lastKeyboard(h.calls).some((b) => b.text === "🔍 По одному")).toBe(true));

    await h.bot.handleUpdate(h.callback(100, button(h.calls, "🔍 По одному")));
    expect(String(sentTo(h.calls, 100).at(-1)!.payload.text)).toContain("1/2");
    await h.bot.handleUpdate(h.callback(100, button(h.calls, "⏭ Пропустить")));
    expect(String(sentTo(h.calls, 100).at(-1)!.payload.text)).toContain("2/2");
    await h.bot.handleUpdate(h.callback(100, button(h.calls, "✅ Ок")));

    await vi.waitFor(async () => expect((await h.db.select().from(words)).map((w) => w.term)).toEqual(["hangar"]));
    await vi.waitFor(() => expect(String(sentTo(h.calls, 200).at(-1)?.payload.text)).toContain("hangar"));
  });

  it("ignores taps on someone else's batch", async () => {
    const h = botHarness({ enricher: enricher([item("serendipity")]) });
    const { friend } = await room(h);
    await h.bot.handleUpdate(h.message(100, "/text serendipity"));
    await vi.waitFor(() => expect(lastKeyboard(h.calls).some((b) => b.text.startsWith("✅ Добавить"))).toBe(true));
    await h.bot.handleUpdate(h.callback(200, button(h.calls, "✅ Добавить")));
    expect(await h.db.select().from(words).where(eq(words.addedBy, friend.id))).toHaveLength(0);
    expect(await h.db.select().from(words)).toHaveLength(0);
  });
});
