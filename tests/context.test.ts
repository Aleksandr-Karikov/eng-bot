import { describe, expect, it, vi } from "vitest";
import { cardText, contextLine, reverseCardText } from "../src/bot/texts";
import { words } from "../src/db/schema";
import type { ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { ALL_PARTS } from "../src/services/card-view";
import { createRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("📍 where the word was met", () => {
  it("bolds the word inside its sentence, in any form", () => {
    expect(contextLine("You totally nailed it, man!", "nail it")).toBe("📍 <i>You totally <b>nailed it</b>, man!</i>");
    expect(contextLine("It’s <weird>", "zzz")).toBe("📍 <i>It’s &lt;weird&gt;</i>");
  });

  it("goes under the spoiler on both card sides and can be hidden", () => {
    const word = { term: "impasse", translation: "тупик", explanation: "", example: "", context: "The talks reached an impasse." };
    expect(cardText(word)).toMatch(/<tg-spoiler>[^]*📍[^]*<\/tg-spoiler>/);
    expect(reverseCardText(word)).toMatch(/<tg-spoiler>[^]*📍[^]*<\/tg-spoiler>/);
    expect(cardText(word, { ...ALL_PARTS, context: false })).not.toContain("📍");
  });

  async function setup(extracted: ExtractedItem[] = []) {
    const enricher: WordEnricher = {
      enrich: async () => ({ translation: "тупик", explanation: "", example: "" }),
      extract: async () => extracted,
      extractImage: async () => extracted,
      check: async () => ({ corrected: "", fixes: [], natural: "" }),
    };
    const h = botHarness({ enricher });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    return { h, room };
  }

  it("keeps the sentence from /text", async () => {
    const { h } = await setup([{ term: "impasse", translation: "тупик", explanation: "", example: "", context: "The talks reached an impasse." }]);
    await h.bot.handleUpdate(h.message(100, "/text The talks reached an impasse."));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Добавить")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Добавить")));
    await vi.waitFor(async () => expect((await h.db.select().from(words)).map((w) => w.context)).toEqual(["The talks reached an impasse."]));
  });

  it("/add as a reply keeps the replied message as context, if the word is in it", async () => {
    const { h, room } = await setup();
    await linkGroup(h.db, room.id, -400);
    const original = { messageId: 7, fromId: 200, text: "Honestly we've hit an impasse with the landlord" };
    await h.bot.handleUpdate(h.groupReplyTo(100, -400, "/add impasse", original));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await h.bot.handleUpdate(h.groupReplyTo(100, -400, "/add stalemate", original));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await vi.waitFor(async () => expect(await h.db.select().from(words)).toHaveLength(2));
    expect((await h.db.select().from(words)).map((w) => [w.term, w.context])).toEqual([
      ["impasse", "Honestly we've hit an impasse with the landlord"],
      ["stalemate", ""],
    ]);
  });
});
