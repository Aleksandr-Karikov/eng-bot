import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { botHarness, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

async function setup(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const words = [];
  for (const term of ["bank", "hangar"]) {
    const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
    if (r.status !== "saved") throw new Error("dup");
    words.push(r.word);
  }
  return { user, words };
}

describe("pronunciation", () => {
  it("synthesizes once per word and accent, then reuses Telegram's file id", async () => {
    const synthesize = vi.fn(async () => Buffer.from("ogg"));
    const h = botHarness({ speech: { synthesize } });
    const { words } = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:u`));
    expect(synthesize).toHaveBeenCalledWith("bank", "uk");
    expect((await getWord(h.db, words[0].id))?.audioUkFileId).toMatch(/^voice-file-/);

    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:u`));
    expect(synthesize).toHaveBeenCalledTimes(1);
    const voices = h.calls.filter((c) => c.method === "sendVoice");
    expect(voices).toHaveLength(2);
    expect(voices[1].payload.voice).toMatch(/^voice-file-/);

    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:s`));
    expect(synthesize).toHaveBeenLastCalledWith("bank", "us");
  });

  it("shows 🔊 on EN → RU cards but not on RU → EN (it would give the answer away)", async () => {
    const h = botHarness();
    const { user } = await setup(h);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(lastButtons(h.calls).map((b) => b.text)).toEqual(expect.arrayContaining(["🔊 UK", "🔊 US"]));

    await h.db.update(cards).set({ state: 2, stability: 5, due: new Date(T0.getTime() - DAY) }).where(eq(cards.userId, user.id));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🔊 UK");
  });

  it("deletes the voice message when moving to the next card", async () => {
    const h = botHarness();
    const { user, words } = await setup(h);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:u`));
    const voiceId = h.calls.findIndex((c) => c.method === "sendVoice") + 1;
    const [card] = await h.db.select().from(cards).where(eq(cards.userId, user.id)).orderBy(cards.id);
    await h.bot.handleUpdate(h.callback(100, `r:${card.id}:0:g`));
    expect(h.calls.some((c) => c.method === "deleteMessage" && c.payload.message_id === voiceId)).toBe(true);
  });

  it("says when speech is unavailable", async () => {
    const h = botHarness({ speech: { synthesize: async () => Promise.reject(new Error("no say")) } });
    const { words } = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:u`));
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("Озвучка недоступна");
  });

  it("forgets cached audio when the word itself changes", async () => {
    const h = botHarness();
    const { words } = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `a:${words[0].id}:u`));
    await updateWord(h.db, words[0].id, { translation: "берег", explanation: "", example: "" });
    expect((await getWord(h.db, words[0].id))?.audioUkFileId).not.toBeNull();
    await updateWord(h.db, words[0].id, { term: "banks", translation: "берега", explanation: "", example: "" });
    expect((await getWord(h.db, words[0].id))?.audioUkFileId).toBeNull();
  });
});
