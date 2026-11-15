import { afterEach, describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app/server";
import { cards, rooms, words } from "../src/db/schema";
import { currentLang } from "../src/lang";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import { parseCorrection } from "../src/llm/enricher";
import { prepareWord } from "../src/services/prepare-word";
import { createRoom } from "../src/services/rooms";
import { getWord, saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { makeUser, T0 } from "./helpers";

const corrected = { term: "tooth", translation: "зуб", explanation: "Teeth — множественное число tooth.", example: "I lost a tooth.", transcriptionUk: "/tuːθ/", transcriptionUs: "/tuθ/" };
const TOKEN = "123:test-token";

afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const h = botHarness();
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, now: T0, draft: { term: "teeth", translation: "зубы", explanation: "", example: "", mnemonic: "old" } });
  if (saved.status !== "saved") throw new Error("fixture");
  h.deps.enricher.correctWord = vi.fn(async () => corrected);
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Test" } }, TOKEN, T0)}`, "content-type": "application/json" };
  const post = (body: unknown, id = saved.word.id) => app.request(`/api/words/${id}/correct`, { method: "POST", headers, body: JSON.stringify(body) });
  return { h, user, room, word: saved.word, post, app };
}

describe("исправление слова из Mini App", () => {
  it("renames the shared word, preserves progress and resets derived content", async () => {
    const { h, word, post } = await setup();
    await h.db.update(words).set({ audioUkFileId: "old", imageFileId: "old", collocations: "old" }).where(eq(words.id, word.id));
    await h.db.update(cards).set({ reps: 3, state: 2, stability: 12 }).where(eq(cards.wordId, word.id));
    const before = await h.db.select().from(cards);
    expect((await post({ instruction: "Здесь множественное число" })).status).toBe(200);
    expect(await getWord(h.db, word.id)).toMatchObject({ ...corrected, termNormalized: "tooth", mnemonic: "", audioUkFileId: null, imageFileId: null, collocations: "" });
    expect(await h.db.select().from(cards)).toEqual(before);
  });

  it("rejects empty/oversized input and words outside the user's rooms before calling the model", async () => {
    const { h, post, app, word } = await setup();
    for (const body of [null, {}, { instruction: " " }, { instruction: "x".repeat(1001) }]) expect((await post(body)).status).toBe(400);
    const outsider = await makeUser(h.db, 200);
    const room = await createRoom(h.db, { name: "Other", createdBy: outsider.id, now: T0 });
    await h.db.update(words).set({ roomId: room.id }).where(eq(words.id, word.id));
    expect((await post({ instruction: "Исправь" })).status).toBe(404);
    expect((await app.request(`/api/words/${word.id}/correct`, { method: "POST" })).status).toBe(401);
    expect(h.deps.enricher.correctWord).not.toHaveBeenCalled();
  });

  it("does not overwrite a duplicate or a failed model response", async () => {
    const { h, user, room, word, post } = await setup();
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, now: T0, draft: corrected });
    expect((await post({ instruction: "Начальная форма" })).status).toBe(409);
    expect(await getWord(h.db, word.id)).toEqual(word);
    h.deps.enricher.correctWord = async () => { throw new Error("offline"); };
    expect((await post({ instruction: "Начальная форма" })).status).toBe(502);
    expect(await getWord(h.db, word.id)).toEqual(word);
  });

  it("uses the word's language even if the user's current room is different", async () => {
    const { h, user, word, room, post } = await setup();
    await h.db.update(rooms).set({ language: "ko" }).where(eq(rooms.id, room.id));
    await createRoom(h.db, { name: "English", createdBy: user.id, now: T0 });
    h.deps.enricher.correctWord = async () => {
      expect(currentLang().code).toBe("ko");
      return { ...corrected, term: "이", translation: "зуб" };
    };
    expect((await post({ instruction: "Исправь" }, word.id)).status).toBe(200);
  });
});

describe("словарная форма при добавлении", () => {
  it("uses the returned lemma and its translation for both draft and mnemonic, detects canonical duplicates", async () => {
    const { h, user, room } = await setup();
    h.deps.enricher.enrich = vi.fn(async () => corrected);
    h.deps.tutor.mnemonics = vi.fn(async () => ["Подсказка к tooth"]);
    const result = await prepareWord(h.deps, room.id, { term: "Teeth", translation: "зубы" });
    // Исходное слово уже есть: для нового ввода проверяем другую форму.
    expect(result.status).toBe("exists");
    const draft = await prepareWord(h.deps, room.id, { term: "teething" });
    expect(draft).toMatchObject({ status: "ok", draft: { ...corrected, mnemonic: "Подсказка к tooth" } });
    expect(h.deps.tutor.mnemonics).toHaveBeenCalledWith([{ term: "tooth", translation: "зуб" }]);
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, now: T0, draft: corrected });
    expect(await prepareWord(h.deps, room.id, { term: "teething" })).toEqual({ status: "exists", term: "tooth" });
  });

  it("sends dictionary rules to the backend for single words, lists, pictures and correction", async () => {
    const ask = vi.fn(async (_prompt: string) => JSON.stringify({ ...corrected, transcription_uk: "/tuːθ/" }));
    const llm = new ClaudeCodeEnricher({ model: "test", timeoutMs: 1000 }, { name: "test", ask });
    await llm.enrich("teeth");
    await llm.enrichFast("went");
    ask.mockResolvedValueOnce(JSON.stringify([corrected]));
    await llm.extract("teeth\nwent");
    ask.mockResolvedValueOnce(JSON.stringify([corrected]));
    await llm.extractImage({ data: Buffer.from("test"), mediaType: "image/png" });
    await llm.correctWord({ ...corrected, term: "teeth" }, "Это множественное число");
    for (const call of ask.mock.calls) expect(call[0]).toContain("teeth → tooth");
    expect(ask.mock.calls.at(-1)?.[0]).toContain("Это множественное число");
    expect(() => parseCorrection('{"translation":"зуб"}')).toThrow();
  });
});
