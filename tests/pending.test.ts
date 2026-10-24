import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewLogs, rooms } from "../src/db/schema";
import type { Enrichment, WordEnricher } from "../src/llm/enricher";
import { saveCloze } from "../src/services/cloze";
import { createRoom } from "../src/services/rooms";
import { getWord, saveWord } from "../src/services/words";
import { updateUser } from "../src/services/users";
import { cards } from "../src/db/schema";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const MIN = 60_000;

function harnessWithSpy() {
  const enrich = vi.fn(async (): Promise<Enrichment> => ({ translation: "перевод", explanation: "", example: "" }));
  const enricher: WordEnricher = { enrich, extractImage: async () => [], extract: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) };
  return { h: botHarness({ enricher }), enrich };
}

async function userWithWord(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  if (r.status !== "saved") throw new Error("dup");
  return { user, room, word: r.word };
}

afterEach(() => vi.useRealTimers());

describe("abandoned «type your answer» prompts", () => {
  it("a command cancels a pending room name, so the next plain word is added", async () => {
    const { h, enrich } = harnessWithSpy();
    await userWithWord(h);
    await h.bot.handleUpdate(h.message(100, "/room"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Новая комната")));
    await h.bot.handleUpdate(h.message(100, "/stats"));
    await h.bot.handleUpdate(h.message(100, "serendipity"));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("serendipity", undefined));
    expect((await h.db.select().from(rooms)).filter((r) => r.personalOf == null).map((r) => r.name)).toEqual(["R"]);
  });

  it("a pending edit expires after 15 minutes instead of overwriting the word", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { h, enrich } = harnessWithSpy();
    const { word } = await userWithWord(h);
    await h.bot.handleUpdate(h.callback(100, `e:${word.id}`));
    vi.setSystemTime(Date.now() + 16 * MIN);
    await h.bot.handleUpdate(h.message(100, "ubiquitous"));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("ubiquitous", undefined));
    expect((await getWord(h.db, word.id))?.translation).toBe("берег");
  });

  it("a cloze card left unanswered expires instead of eating the next word", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { h, enrich } = harnessWithSpy();
    const { word } = await userWithWord(h);
    await h.db.update(cards).set({ state: 2, stability: 20, reps: 4, due: new Date(T0.getTime() - DAY) });
    await saveCloze(h.db, word.id, [{ sentence: "On the ___.", answer: "bank", translation: "" }], T0);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    vi.setSystemTime(Date.now() + 16 * MIN);
    await h.bot.handleUpdate(h.message(100, "ubiquitous"));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("ubiquitous", undefined));
    expect(await h.db.select().from(reviewLogs)).toHaveLength(0);
  });

  it("only one prompt waits at a time: a newer prompt replaces the older one", async () => {
    const { h, enrich } = harnessWithSpy();
    const { word } = await userWithWord(h);
    await h.bot.handleUpdate(h.callback(100, `e:${word.id}`));
    await h.bot.handleUpdate(h.message(100, "/room"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Новая комната")));
    await h.bot.handleUpdate(h.message(100, "Club"));
    expect((await h.db.select().from(rooms)).filter((r) => r.personalOf == null).map((r) => r.name).sort()).toEqual(["Club", "R"]);
    await h.bot.handleUpdate(h.message(100, "ubiquitous"));
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledWith("ubiquitous", undefined));
    expect((await getWord(h.db, word.id))?.translation).toBe("берег");
  });
});
