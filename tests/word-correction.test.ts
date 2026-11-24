import { afterEach, describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app/server";
import { cards, rooms, words } from "../src/db/schema";
import { EN } from "../src/lang";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import { parseCorrection } from "../src/llm/enricher";
import { prepareWord } from "../src/services/prepare-word";
import { createRoom } from "../src/services/rooms";
import { getWord, saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { makeUser, T0, at } from "./helpers";

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
  h.deps.enricher.correctWord = vi.fn(async () => ({ message: "Исправил начальную форму и перевод", patch: corrected }));
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Test" } }, TOKEN, T0)}`, "content-type": "application/json" };
  const post = (body: unknown, id = saved.word.id) => app.request(`/api/words/${id}/correct`, { method: "POST", headers, body: JSON.stringify(body) });
  const apply = (draftId: string, id = saved.word.id) => app.request(`/api/words/${id}/correct/apply`, { method: "POST", headers, body: JSON.stringify({ draftId }) });
  return { h, user, room, word: saved.word, post, apply, app };
}

describe("исправление слова из Mini App", () => {
  it("previews the full before/after without writing, then saves only the approved server draft", async () => {
    const { h, word, post, apply } = await setup();
    const collocations = JSON.stringify({ items: [{ phrase: "teeth cleaning", translation: "чистка зубов" }] });
    await h.db.update(words).set({ audioUkFileId: "old", imageFileId: "old", collocations, usefulness: 3 }).where(eq(words.id, word.id));
    await h.db.update(cards).set({ reps: 3, state: 2, stability: 12 }).where(eq(cards.wordId, word.id));
    const before = await getWord(h.db, word.id);
    const progress = await h.db.select().from(cards);
    const preview = await (await post({ instruction: "Здесь множественное число" })).json();
    expect(preview).toMatchObject({ ok: true, message: "Исправил начальную форму и перевод", before: { term: "teeth", mnemonic: "old" }, after: { ...corrected, mnemonic: "old", usefulness: 3 } });
    expect(preview.effects).toHaveLength(2);
    expect(await getWord(h.db, word.id)).toEqual(before);
    expect((await apply("invented-token")).status).toBe(409);
    expect((await apply(preview.draftId)).status).toBe(200);
    expect(await getWord(h.db, word.id)).toMatchObject({ ...corrected, termNormalized: "tooth", mnemonic: "old", collocations, usefulness: 3, audioUkFileId: null, imageFileId: null });
    expect(await h.db.select().from(cards)).toEqual(progress);
    expect((await apply(preview.draftId)).status).toBe(409);
  });

  it("refines the draft without discarding unchanged fields or saving either version", async () => {
    const { h, word, post, apply } = await setup();
    const first = await (await post({ instruction: "Начальная форма" })).json();
    h.deps.enricher.correctWord = vi.fn(async () => ({ message: "Добавил формы", patch: { explanation: "tooth — teeth" } }));
    const next = await (await post({ instruction: "Добавь формы", draftId: first.draftId })).json();
    expect(next.after).toMatchObject({ term: "tooth", explanation: "tooth — teeth", mnemonic: "old" });
    expect(next.before.term).toBe("teeth");
    expect(h.deps.enricher.correctWord).toHaveBeenCalledWith(expect.objectContaining({ term: "tooth" }), expect.stringContaining("Начальная форма\nУточнение: Добавь формы"));
    expect(await getWord(h.db, word.id)).toEqual(word);
    expect((await apply(first.draftId)).status).toBe(409);
    expect((await apply(next.draftId)).status).toBe(200);
  });

  it("rejects approval if another edit or a timeout made the preview stale", async () => {
    const { h, word, post, apply } = await setup();
    const preview = await (await post({ instruction: "Начальная форма" })).json();
    await h.db.update(words).set({ mnemonic: "Новая чужая запоминалка" }).where(eq(words.id, word.id));
    expect((await apply(preview.draftId)).status).toBe(409);
    expect(await getWord(h.db, word.id)).toMatchObject({ term: "teeth", mnemonic: "Новая чужая запоминалка" });
    const next = await (await post({ instruction: "Начальная форма" })).json();
    h.deps.now = () => at(31 * 60_000);
    expect((await apply(next.draftId)).status).toBe(409);
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
    const { h, user, room, word, post, apply } = await setup();
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, now: T0, draft: corrected });
    const preview = await (await post({ instruction: "Начальная форма" })).json();
    expect((await apply(preview.draftId)).status).toBe(409);
    expect(await getWord(h.db, word.id)).toEqual(word);
    h.deps.enricher.correctWord = async () => { throw new Error("offline"); };
    expect((await post({ instruction: "Начальная форма" })).status).toBe(502);
    expect(await getWord(h.db, word.id)).toEqual(word);
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

  it("sends dictionary rules to the backend for single words, lists and pictures, but corrections only follow the user request", async () => {
    const ask = vi.fn(async (_prompt: string) => JSON.stringify({ ...corrected, transcription_uk: "/tuːθ/" }));
    const llm = new ClaudeCodeEnricher({ model: "test", timeoutMs: 1000 }, { name: "test", ask });
    await llm.enrich("teeth");
    await llm.enrichFast("went");
    ask.mockResolvedValueOnce(JSON.stringify([corrected]));
    await llm.extract("teeth\nwent");
    ask.mockResolvedValueOnce(JSON.stringify([corrected]));
    await llm.extractImage({ data: Buffer.from("test"), mediaType: "image/png" });
    for (const call of ask.mock.calls) expect(call[0]).toContain("teeth → tooth");
    ask.mockResolvedValueOnce(JSON.stringify({ message: "Исправлено", patch: { term: "tooth" } }));
    await llm.correctWord({ ...corrected, term: "teeth", mnemonic: "", collocations: "", leechHelp: "", context: "", moreContexts: "[]" }, "Это множественное число");
    expect(ask.mock.calls.at(-1)?.[0]).toContain("Это множественное число");
    expect(parseCorrection('{"message":"Поменял пример","patch":{"example":"New example."}}')).toEqual({ message: "Поменял пример", patch: { example: "New example." } });
    expect(() => parseCorrection('{"message":"x","patch":{"roomId":99}}')).toThrow();
    expect(() => parseCorrection('{"translation":"зуб"}')).toThrow();
  });
});
