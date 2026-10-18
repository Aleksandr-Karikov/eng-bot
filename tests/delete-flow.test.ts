import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import type { ExtractedItem } from "../src/llm/enricher";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { deleteWord, saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { MIN, T0, at, makeUser } from "./helpers";

const draft = (term: string) => ({ term, translation: `t-${term}`, explanation: "", example: "" });

async function room(h: ReturnType<typeof botHarness>) {
  const author = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const friend = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
  const r = await createRoom(h.db, { name: "R", createdBy: author.id, now: T0 });
  await joinRoom(h.db, { roomId: r.id, userId: friend.id, now: T0, makeCurrent: true });
  const add = async (term: string, now = T0) => {
    const res = await saveWord(h.db, { roomId: r.id, addedBy: author.id, draft: draft(term), now });
    if (res.status !== "saved") throw new Error("dup");
    return res.word;
  };
  return { author, friend, room: r, add };
}

const terms = async (h: ReturnType<typeof botHarness>) => (await h.db.select().from(words)).map((w) => w.term);

describe("deleting words", () => {
  it("deletes a word right after adding it, with confirmation", async () => {
    const h = botHarness();
    await room(h);
    await h.bot.handleUpdate(h.message(100, "/add bank"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await vi.waitFor(async () => expect(await terms(h)).toEqual(["bank"]));

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Удалить")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Да")));
    expect(await terms(h)).toEqual([]);
    expect(await h.db.select().from(cards)).toHaveLength(0);
  });

  it("/delete with a fragment that matches one phrase asks to confirm right away", async () => {
    const h = botHarness();
    const { add } = await room(h);
    await add("bank");
    await add("his arse is drowning in the butter", at(MIN));
    await h.bot.handleUpdate(h.message(200, "/delete butter"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "🗑 Да")).not.toThrow());
    await h.bot.handleUpdate(h.callback(200, buttonData(h.calls, "🗑 Да")));
    expect(await terms(h)).toEqual(["bank"]);
  });

  it("/delete without text lists newest first and pages", async () => {
    const h = botHarness();
    const { add } = await room(h);
    for (let i = 0; i < 30; i++) await add(`w${i}`, at(i * MIN));
    await h.bot.handleUpdate(h.message(100, "/delete"));
    await vi.waitFor(() => expect(lastButtons(h.calls).some((b) => b.text === "1/2")).toBe(true));
    expect(lastButtons(h.calls)[0].text).toMatch(/^w29/);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "▶")));
    expect(lastButtons(h.calls)[0].text).toMatch(/^w4/);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "w0")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Да")));
    expect(await terms(h)).not.toContain("w0");
    expect(await terms(h)).toHaveLength(29);
  });

  it("offers deletion on the back of a learn card", async () => {
    const h = botHarness();
    const { author, add } = await room(h);
    await add("bank");
    const [card] = await h.db.select().from(cards).where(eq(cards.userId, author.id));
    await h.bot.handleUpdate(h.callback(100, `s:${card.id}:0`));
    expect(lastButtons(h.calls).some((b) => b.text === "🗑 Удалить")).toBe(false);
    await h.bot.handleUpdate(h.manage(100));
    expect(lastButtons(h.calls).some((b) => b.text === "🗑 Удалить")).toBe(true);
  });

  it("answers a stale «знаешь?» on a deleted word", async () => {
    const h = botHarness();
    const { add } = await room(h);
    const bank = await add("bank");
    await deleteWord(h.db, bank.id);
    await h.bot.handleUpdate(h.callback(200, `k:${bank.id}:y`));
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("удалили");
  });

  it("undoes a whole /text batch", async () => {
    const items: ExtractedItem[] = [draft("serendipity"), draft("hangar")];
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "x", explanation: "", example: "" }),
        extractImage: async () => [], extract: async () => items,
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
    });
    await room(h);
    await h.bot.handleUpdate(h.message(100, "/text serendipity hangar"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Добавить")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Добавить")));
    expect(await terms(h)).toHaveLength(2);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Удалить всё (2)")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗑 Да")));
    expect(await terms(h)).toEqual([]);
  });

  it("does not let a non-member delete", async () => {
    const h = botHarness();
    const { add } = await room(h);
    const bank = await add("bank");
    await makeUser(h.db, 300);
    await h.bot.handleUpdate(h.callback(300, `xo:${bank.id}`));
    expect(await terms(h)).toEqual(["bank"]);
  });
});
