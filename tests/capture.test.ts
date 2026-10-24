import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { rooms, words } from "../src/db/schema";
import { eq } from "drizzle-orm";
import type { Enrichment, ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { capture, cleanSelection, readImage } from "../src/capture/capture";
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
    const result = await capture(h.deps, { key: "secret-key", text: "beat around the bush,", context: line, title: "The Rainmaker S1E3" });
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
    await capture(h.deps, { key: "secret-key", text: "beat around the bush", context: line });
    const result = await capture(h.deps, { key: "secret-key", text: "", context: line });
    expect(extract).toHaveBeenCalledWith(line);
    expect(result).toEqual({ ok: true, added: [{ term: "a long shot", translation: "маловероятно" }], duplicates: ["beat around the bush"] });
  });

  it("rejects a wrong key; without a room the word goes to the personal dictionary", async () => {
    const { h, user } = await setup();
    expect(await capture(h.deps, { key: "nope", text: "x", context: line })).toMatchObject({ ok: false, status: 401 });
    await updateUser(h.db, user.id, { currentRoomId: null });
    expect(await capture(h.deps, { key: "secret-key", text: "beat around the bush", context: line })).toMatchObject({ ok: true });
    const [word] = await h.db.select().from(words);
    const [room] = await h.db.select().from(rooms).where(eq(rooms.id, word.roomId));
    expect(room).toMatchObject({ name: "Мои слова", personalOf: user.id });
  });

  it("tells friends right away, each word with «знаешь?» buttons like any new word", async () => {
    const { h } = await setup();
    await capture(h.deps, { key: "secret-key", text: "beat around the bush", context: line });
    await capture(h.deps, { key: "secret-key", text: "a long shot", context: line });
    const prompts = h.calls.filter((c) => c.method === "sendMessage" && c.payload.chat_id === 200);
    expect(prompts).toHaveLength(2);
    expect(String(prompts[0].payload.text)).toContain("beat around the bush");
    expect(JSON.stringify(prompts[1].payload.reply_markup)).toContain("Не для меня");
  });

  it("🔲 reads the text of a screen area for the panel, only with a valid key", async () => {
    const { h } = await setup();
    const readImageMock = vi.fn(async () => "Cracking on nicely, I gather.");
    h.deps.enricher = { ...h.deps.enricher, readImage: readImageMock };
    const image = `data:image/jpeg;base64,${Buffer.from("fake-jpeg").toString("base64")}`;
    expect(await readImage(h.deps, { key: "nope", image })).toMatchObject({ ok: false, status: 401 });
    expect(await readImage(h.deps, { key: "secret-key", image: "not an image" })).toMatchObject({ ok: false, status: 400 });
    expect(await readImage(h.deps, { key: "secret-key", image })).toEqual({ ok: true, text: "Cracking on nicely, I gather." });
    expect(readImageMock).toHaveBeenCalledWith({ data: Buffer.from("fake-jpeg"), mediaType: "image/jpeg" });
  });

  it("listens on localhost: /ping checks the key, /capture adds", async () => {
    const { h } = await setup();
    server = startCaptureServer(h.deps, 0);
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

describe("📦 the extension right in the chat", () => {
  it("sends a fresh zip of the extension folder", async () => {
    const { h } = await setup();
    h.deps.capturePort = 8787;
    await h.bot.handleUpdate(h.message(100, "/extension"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "📦 Скачать расширение")));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendDocument")).toBe(true));
    const doc = h.calls.find((c) => c.method === "sendDocument")!;
    expect(String(doc.payload.caption)).toContain("Загрузить распакованное");
    // Ключ и адрес вписаны в архив — после установки ничего настраивать не нужно.
    const zip = (doc.payload.document as { fileData: Buffer }).fileData;
    const dir = mkdtempSync(join(tmpdir(), "ext-test-"));
    writeFileSync(join(dir, "ext.zip"), zip);
    const preset = JSON.parse(execFileSync("unzip", ["-p", join(dir, "ext.zip"), "wordboss/preset.json"], { encoding: "utf8" }));
    expect(preset).toEqual({ key: "secret-key", server: "http://localhost:8787" });
    expect(execFileSync("unzip", ["-l", join(dir, "ext.zip")], { encoding: "utf8" })).toContain("wordboss/manifest.json");
  });
});
