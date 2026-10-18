import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import type { Enrichment, WordEnricher } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { MIN, T0, at, makeUser } from "./helpers";

const draft = (term: string) => ({ term, translation: `t-${term}`, explanation: "old", example: "old example" });

function enricher(enrich: WordEnricher["enrich"]): WordEnricher {
  return { enrich, extractImage: async () => [], extract: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) };
}

async function room(h: ReturnType<typeof botHarness>, telegramChatId?: number) {
  const author = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const r = await createRoom(h.db, { name: "R", createdBy: author.id, now: T0, telegramChatId });
  const add = async (term: string, now = T0) => {
    const res = await saveWord(h.db, { roomId: r.id, addedBy: author.id, draft: draft(term), now });
    if (res.status !== "saved") throw new Error("dup");
    return res.word;
  };
  return { author, room: r, add };
}

const sent = (h: ReturnType<typeof botHarness>, needle: string) =>
  h.calls.filter((c) => c.method === "sendMessage" && String(c.payload.text).includes(needle));

describe("editing words", () => {
  it("fixes the translation and regenerates explanation and example", async () => {
    const enrich = vi.fn(async (): Promise<Enrichment> => ({ translation: "ignored", explanation: "new expl", example: "new example" }));
    const h = botHarness({ enricher: enricher(enrich) });
    const { add } = await room(h);
    const bank = await add("bank");
    await h.bot.handleUpdate(h.callback(100, `e:${bank.id}`));
    expect(sent(h, "Пришли исправление")).toHaveLength(1);

    await h.bot.handleUpdate(h.message(100, "берег реки"));
    await vi.waitFor(() => expect(sent(h, "Обновлено")).toHaveLength(1));
    expect(enrich).toHaveBeenCalledWith("bank", "берег реки");
    expect(await getWord(h.db, bank.id)).toMatchObject({ term: "bank", translation: "берег реки", explanation: "new expl", example: "new example" });
    expect(await h.db.select().from(words)).toHaveLength(1);
  });

  it("renames the term with «word — translation» and keeps progress", async () => {
    const h = botHarness();
    const { author, add } = await room(h);
    const bank = await add("bnak");
    await h.db.update(cards).set({ reps: 3 }).where(eq(cards.userId, author.id));
    await h.bot.handleUpdate(h.callback(100, `e:${bank.id}`));
    await h.bot.handleUpdate(h.message(100, "bank — берег"));
    await vi.waitFor(() => expect(sent(h, "Обновлено")).toHaveLength(1));
    expect(await getWord(h.db, bank.id)).toMatchObject({ term: "bank", translation: "берег" });
    expect((await h.db.select().from(cards))[0].reps).toBe(3);
  });

  it("refuses to rename onto an existing word and keeps the old text if Claude fails", async () => {
    const h = botHarness({ enricher: enricher(async () => Promise.reject(new Error("timeout"))) });
    const { add } = await room(h);
    await add("bank");
    const hangar = await add("hangar", at(MIN));
    await h.bot.handleUpdate(h.callback(100, `e:${hangar.id}`));
    await h.bot.handleUpdate(h.message(100, "BANK — x"));
    await vi.waitFor(() => expect(sent(h, "уже есть")).toHaveLength(1));
    expect((await getWord(h.db, hangar.id))?.translation).toBe("t-hangar");

    await h.bot.handleUpdate(h.callback(100, `e:${hangar.id}`));
    await h.bot.handleUpdate(h.message(100, "ангар"));
    await vi.waitFor(() => expect(sent(h, "Обновлено")).toHaveLength(1));
    expect(await getWord(h.db, hangar.id)).toMatchObject({ translation: "ангар", explanation: "old", example: "old example" });
  });

  it("/edit with a fragment that matches one phrase asks for the fix right away", async () => {
    const h = botHarness();
    const { add } = await room(h);
    await add("bank");
    await add("his arse is drowning in the butter", at(MIN));
    await h.bot.handleUpdate(h.message(100, "/edit butter"));
    await vi.waitFor(() => expect(sent(h, "Пришли исправление")).toHaveLength(1));
    expect(String(sent(h, "Пришли исправление")[0].payload.text)).toContain("butter");
  });

  it("/edit without text lists words to pick from", async () => {
    const h = botHarness();
    const { add } = await room(h);
    await add("bank");
    await add("hangar", at(MIN));
    await h.bot.handleUpdate(h.message(100, "/edit"));
    await vi.waitFor(() => expect(lastButtons(h.calls)[0]?.text).toMatch(/^hangar/));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "bank")));
    expect(sent(h, "Пришли исправление")).toHaveLength(1);
  });

  it("offers editing after adding and on the back of a learn card", async () => {
    const h = botHarness();
    const { author, add } = await room(h);
    await add("bank");
    const [card] = await h.db.select().from(cards).where(eq(cards.userId, author.id));
    await h.bot.handleUpdate(h.callback(100, `s:${card.id}:0`));
    await h.bot.handleUpdate(h.manage(100));
    expect(lastButtons(h.calls).some((b) => b.text === "✏️ Изменить")).toBe(true);

    await h.bot.handleUpdate(h.message(100, "/add hangar"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✏️ Изменить")).not.toThrow());
  });

  it("does not let a non-member edit", async () => {
    const h = botHarness();
    const { add } = await room(h);
    const bank = await add("bank");
    await makeUser(h.db, 300);
    await h.bot.handleUpdate(h.callback(300, `e:${bank.id}`));
    expect(sent(h, "Пришли исправление")).toHaveLength(0);
  });

  it("in a group, takes the fix only from a reply to the bot", async () => {
    const h = botHarness();
    const { add } = await room(h, -500);
    const bank = await add("bank");
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/edit bank"));
    await vi.waitFor(() => expect(sent(h, "Пришли исправление")).toHaveLength(1));
    await h.bot.handleUpdate(h.groupMessage(100, -500, "lol chatter"));
    expect((await getWord(h.db, bank.id))?.translation).toBe("t-bank");
    await h.bot.handleUpdate(h.groupMessage(100, -500, "берег", true));
    await vi.waitFor(async () => expect((await getWord(h.db, bank.id))?.translation).toBe("берег"));
  });
});

