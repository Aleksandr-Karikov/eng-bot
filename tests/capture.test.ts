import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { words } from "../src/db/schema";
import type { Enrichment, ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { capture, CaptureBroadcaster, cleanSelection } from "../src/capture/capture";
import { startCaptureServer } from "../src/capture/server";
import { createRoom, joinRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const line = "Let's not beat around the bush, we both know this deal is a long shot.";

async function setup() {
  const enrich = vi.fn(async (_term: string, _hint?: string, _context?: string): Promise<Enrichment> => ({ translation: "ходить вокруг да около", explanation: "", example: "" }));
  const extract = vi.fn(async (_text: string): Promise<ExtractedItem[]> => [
    { term: "beat around the bush", translation: "ходить вокруг да около", explanation: "", example: "" },
    { term: "a long shot", translation: "маловероятно", explanation: "", example: "" },
  ]);
  const enricher: WordEnricher = { enrich, extract, extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) };
  const h = botHarness({ enricher });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, captureKey: "secret-key" });
  const friend = await updateUser(h.db, (await makeUser(h.db, 200, "Артём")).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await joinRoom(h.db, { roomId: room.id, userId: friend.id, now: T0, makeCurrent: true });
  return { h, enrich, extract, user, friend };
}

const dms = (h: ReturnType<typeof botHarness>, chatId: number) =>
  h.calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === chatId).map((c) => String(c.payload.text));

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

describe("words from the browser extension", () => {
  it("trims quotes and punctuation around a selection", () => {
    expect(cleanSelection(" “bush,” ")).toBe("bush");
    expect(cleanSelection("— a long shot.")).toBe("a long shot");
  });

  it("adds the selection at once, translated in the sense of the line, with the line as context", async () => {
    const { h, enrich, user } = await setup();
    const broadcaster = new CaptureBroadcaster(h.deps, 60_000);
    const result = await capture(h.deps, broadcaster, { key: "secret-key", text: "beat around the bush,", context: line, title: "The Rainmaker S1E3" });
    expect(result).toEqual({ ok: true, added: [{ term: "beat around the bush", translation: "ходить вокруг да около" }], duplicates: [] });
    expect(enrich).toHaveBeenCalledWith("beat around the bush", undefined, line);
    expect((await h.db.select().from(words)).map((w) => [w.term, w.context])).toEqual([["beat around the bush", line]]);
    const dm = dms(h, 100).at(-1)!;
    expect(dm).toContain("➕ <b>beat around the bush</b> — ходить вокруг да около");
    expect(dm).toContain("🎬 <i>The Rainmaker S1E3</i>");
    expect(dm).toContain("<b>beat around the bush</b>, we both");
    void user;
  });

  it("without a selection lets Claude pick from the whole line and reports duplicates", async () => {
    const { h, extract } = await setup();
    const broadcaster = new CaptureBroadcaster(h.deps, 60_000);
    await capture(h.deps, broadcaster, { key: "secret-key", text: "beat around the bush", context: line });
    const result = await capture(h.deps, broadcaster, { key: "secret-key", text: "", context: line });
    expect(extract).toHaveBeenCalledWith(line);
    expect(result).toEqual({ ok: true, added: [{ term: "a long shot", translation: "маловероятно" }], duplicates: ["beat around the bush"] });
  });

  it("rejects a wrong key or a user without a room", async () => {
    const { h, user } = await setup();
    const broadcaster = new CaptureBroadcaster(h.deps, 60_000);
    expect(await capture(h.deps, broadcaster, { key: "nope", text: "x", context: line })).toMatchObject({ ok: false, status: 401 });
    await updateUser(h.db, user.id, { currentRoomId: null });
    expect(await capture(h.deps, broadcaster, { key: "secret-key", text: "x", context: line })).toMatchObject({ ok: false, status: 400 });
  });

  it("tells friends once, after a pause, without the words that were undone", async () => {
    vi.useFakeTimers();
    try {
      const { h } = await setup();
      const broadcaster = new CaptureBroadcaster(h.deps, 10 * 60_000);
      h.deps.capture = broadcaster;
      await capture(h.deps, broadcaster, { key: "secret-key", text: "beat around the bush", context: line });
      await capture(h.deps, broadcaster, { key: "secret-key", text: "a long shot", context: line });
      expect(dms(h, 200)).toEqual([]);
      await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "↩️ Отменить")));
      expect((await h.db.select().from(words)).map((w) => w.term)).toEqual(["beat around the bush"]);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(dms(h, 200)).toHaveLength(1);
      expect(dms(h, 200)[0]).toContain("beat around the bush");
      expect(dms(h, 200)[0]).not.toContain("a long shot");
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens on localhost: /ping checks the key, /capture adds", async () => {
    const { h } = await setup();
    server = startCaptureServer(h.deps, new CaptureBroadcaster(h.deps, 60_000), 0);
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${base}/ping?key=secret-key`)).json()).toEqual({ ok: true, name: "User100", room: "R" });
    expect((await fetch(`${base}/ping?key=bad`)).status).toBe(401);
    const res = await fetch(`${base}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "secret-key", text: "long shot", context: line }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { added: unknown[] }).added).toHaveLength(1);
  });

  it("/extension hands out a personal key and can replace it", async () => {
    const { h, user } = await setup();
    h.deps.capturePort = 8787;
    await updateUser(h.db, user.id, { captureKey: null });
    await h.bot.handleUpdate(h.message(100, "/extension"));
    const key = (await getUser(h.db, user.id))!.captureKey!;
    expect(key.length).toBeGreaterThan(20);
    expect(dms(h, 100).at(-1)).toContain(key);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔄 Новый ключ")));
    expect((await getUser(h.db, user.id))!.captureKey).not.toBe(key);
  });
});
