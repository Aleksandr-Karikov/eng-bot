import { describe, expect, it, vi } from "vitest";
import type { Enrichment, ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function setup() {
  const enrich = vi.fn(async (): Promise<Enrichment> => ({ translation: "перевод", explanation: "", example: "" }));
  const extract = vi.fn(async (): Promise<ExtractedItem[]> => []);
  const enricher: WordEnricher = { enrich, extract, check: async () => ({ corrected: "", fixes: [], natural: "" }) };
  return { h: botHarness({ enricher }), enrich, extract };
}

async function groupRoom(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  await makeUser(h.db, 200);
  await createRoom(h.db, { name: "R", createdBy: user.id, now: T0, telegramChatId: -500 });
}

describe("/add and /text as a reply", () => {
  it("/text without text takes the replied-to message", async () => {
    const { h, extract } = setup();
    await groupRoom(h);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/text", { messageId: 7, fromId: 200, text: "We took it for granted, honestly" }));
    await vi.waitFor(() => expect(extract).toHaveBeenCalledWith("We took it for granted, honestly"));
  });

  it("/add without text takes the replied-to message", async () => {
    const { h, enrich } = setup();
    await groupRoom(h);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/add", { messageId: 7, fromId: 200, text: "spill the beans" }));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("spill the beans", undefined));
  });

  it("text in the command wins over the replied-to message", async () => {
    const { h, enrich } = setup();
    await groupRoom(h);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/add bank", { messageId: 7, fromId: 200, text: "spill the beans" }));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("bank", undefined));
  });
});
