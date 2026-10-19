import { afterEach, describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import type { ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { createRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const item: ExtractedItem = { term: "impasse", translation: "тупик", explanation: "", example: "" };

async function setup(items: ExtractedItem[] = [item]) {
  const extractImage = vi.fn(async () => items);
  const enricher: WordEnricher = {
    enrich: async () => ({ translation: "t", explanation: "", example: "" }),
    extract: async () => [],
    extractImage,
    check: async () => ({ corrected: "", fixes: [], natural: "" }),
  };
  const h = botHarness({ enricher });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const fetchMock = vi.fn(async (_url: string) => new Response(Buffer.from("jpeg-bytes")));
  vi.stubGlobal("fetch", fetchMock);
  return { h, extractImage, fetchMock, room };
}

afterEach(() => vi.unstubAllGlobals());

const photo = (chat: { id: number; type: "private" | "group" }, caption?: string, extra: Record<string, unknown> = {}) =>
  ({
    update_id: Math.floor(Math.random() * 1e6),
    message: {
      message_id: 50,
      date: 0,
      chat: chat.type === "private" ? { ...chat, first_name: "U" } : { ...chat, title: "G" },
      from: { id: 100, is_bot: false, first_name: "User100" },
      photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 90 }, { file_id: "big", file_unique_id: "b", width: 1280, height: 900, file_size: 200_000 }],
      caption,
      ...extra,
    },
  }) as unknown as Update;

describe("📸 words from a screenshot", () => {
  it("in a DM a photo is read like a text, the caption is a wish", async () => {
    const { h, extractImage, fetchMock } = await setup();
    await h.bot.handleUpdate(photo({ id: 100, type: "private" }, "only idioms"));
    await vi.waitFor(() => expect(lastButtons(h.calls).some((b) => b.text.includes("impasse"))).toBe(true));
    expect(h.calls.find((c) => c.method === "getFile")?.payload.file_id).toBe("big");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/file/bottest-token/photos/file_1.jpg");
    expect(extractImage).toHaveBeenCalledWith({ data: Buffer.from("jpeg-bytes"), mediaType: "image/jpeg" }, "only idioms");
  });

  it("in a group /text works as a reply to a photo", async () => {
    const { h, extractImage, room } = await setup();
    await linkGroup(h.db, room.id, -300);
    const reply = h.groupMessage(100, -300, "/text");
    reply.message!.reply_to_message = photo({ id: -300, type: "group" }).message as never;
    await h.bot.handleUpdate(reply);
    await vi.waitFor(() => expect(extractImage).toHaveBeenCalledTimes(1));
  });

  it("a photo with the caption /text works in a group, and the rest of the caption is the wish", async () => {
    const { h, extractImage, room } = await setup();
    await linkGroup(h.db, room.id, -300);
    // Как шлёт Telegram: команда в подписи — в caption_entities, не в entities.
    await h.bot.handleUpdate(photo({ id: -300, type: "group" }, "/text only idioms", { caption_entities: [{ type: "bot_command", offset: 0, length: 5 }] }));
    await vi.waitFor(() => expect(extractImage).toHaveBeenCalledWith(expect.anything(), "only idioms"));
    const dm = await setup();
    await dm.h.bot.handleUpdate(photo({ id: 100, type: "private" }, "/text"));
    await vi.waitFor(() => expect(dm.extractImage).toHaveBeenCalledWith(expect.anything(), undefined));
  });

  it("ignores photos in a group without /text", async () => {
    const { h, extractImage, room } = await setup();
    await linkGroup(h.db, room.id, -300);
    await h.bot.handleUpdate(photo({ id: -300, type: "group" }, "look at this"));
    await new Promise((r) => setTimeout(r, 20));
    expect(extractImage).not.toHaveBeenCalled();
  });

  it("refuses huge files and says when there is no English", async () => {
    const big = await setup();
    const doc = photo({ id: 100, type: "private" }, undefined, {
      photo: undefined,
      document: { file_id: "doc", file_unique_id: "d", mime_type: "image/png", file_size: 9_000_000 },
    });
    await big.h.bot.handleUpdate(doc);
    await vi.waitFor(() => expect(big.h.calls.some((c) => String(c.payload.text).includes("слишком большая"))).toBe(true));
    expect(big.fetchMock).not.toHaveBeenCalled();

    const empty = await setup([]);
    await empty.h.bot.handleUpdate(photo({ id: 100, type: "private" }));
    await vi.waitFor(() => expect(empty.h.calls.some((c) => String(c.payload.text).includes("Не нашёл тут английского"))).toBe(true));
  });
});
