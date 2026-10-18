import { describe, expect, it, vi } from "vitest";
import { rooms } from "../src/db/schema";
import type { ExerciseTutor } from "../src/llm/tutor";
import { sendDigests } from "../src/reminder-loop";
import { digestDue } from "../src/services/digest";
import { recentMistakes, recordMistakes } from "../src/services/mistakes";
import { answerCard, nextDue } from "../src/services/review";
import { createRoom, deleteRoom, linkGroup } from "../src/services/rooms";
import { getWord, saveWord } from "../src/services/words";
import { updateUser } from "../src/services/users";
import { speakableText } from "../src/speech/tts";
import type { User } from "../src/db/schema";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

const nsk = (iso: string) => new Date(`${iso}+07:00`);

describe("/check author", () => {
  it("records for the caller when the text came from the command, not the replied-to photo", async () => {
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "", explanation: "", example: "" }),
        extractImage: async () => [], extract: async () => [],
        check: async () => ({ corrected: "he **goes**", fixes: [{ wrong: "go", right: "goes", why: "", category: "времена" }], natural: "" }),
      },
    });
    const caller = await makeUser(h.db, 100);
    const photoAuthor = await makeUser(h.db, 200);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/check he go", { messageId: 9, fromId: 200, text: "" }));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Сохранить")).not.toThrow());
    await h.bot.handleUpdate(h.groupCallback(100, -500, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, caller.id, T0)).toHaveLength(1);
    expect(await recentMistakes(h.db, photoAuthor.id, T0)).toHaveLength(0);
  });
});

describe("/edit with a dash in the translation", () => {
  it("keeps the English term when the left side is not English", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "give in", translation: "x", explanation: "", example: "" }, now: T0 });
    if (r.status !== "saved") throw new Error("dup");
    await h.bot.handleUpdate(h.callback(100, `e:${r.word.id}`));
    await h.bot.handleUpdate(h.message(100, "сдаться — уступить"));
    await vi.waitFor(async () => expect((await getWord(h.db, r.word.id))?.translation).toBe("сдаться — уступить"));
    expect((await getWord(h.db, r.word.id))?.term).toBe("give in");
  });
});

describe("digest catch-up and fallback", () => {
  it("catches up within 48 hours after Sunday 20:00 if the bot was down", () => {
    expect(digestDue({ lastDigestDate: null }, nsk("2026-10-19T09:00"))).toBe("2026-10-18");
    expect(digestDue({ lastDigestDate: "2026-10-18" }, nsk("2026-10-19T09:00"))).toBeNull();
    expect(digestDue({ lastDigestDate: "2026-10-11" }, nsk("2026-10-20T19:59"))).toBe("2026-10-18");
    expect(digestDue({ lastDigestDate: "2026-10-11" }, nsk("2026-10-20T20:01"))).toBeNull();
    expect(digestDue({ lastDigestDate: "2026-10-11" }, nsk("2026-10-18T19:59"))).toBeNull();
  });

  it("falls back to DMs when the group post fails", async () => {
    const db = testDb();
    const alice = await updateUser(db, (await makeUser(db, 1, "Alice")).id, { canDm: true });
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: nsk("2026-10-12T10:00") });
    await linkGroup(db, room.id, -900);
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "a", translation: "t", explanation: "", example: "" }, now: nsk("2026-10-15T10:00") });
    const item = (await nextDue(db, alice.id, nsk("2026-10-16T12:00")))!;
    await answerCard(db, { userId: alice.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: nsk("2026-10-16T12:00") });
    const dms: string[] = [];
    const notifier = { dm: async (u: User) => (dms.push(u.firstName), true), group: async () => false };
    await sendDigests({ db, notifier, now: () => nsk("2026-10-18T20:00") });
    expect(dms).toEqual(["Alice"]);
  });
});

describe("saving into a deleted room", () => {
  it("tells the user instead of failing when the room was deleted meanwhile", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/add bank"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    await deleteRoom(h.db, room.id);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    expect(h.calls.some((c) => String(c.payload.text).includes("Комнату уже удалили"))).toBe(true);
    expect(await h.db.select().from(rooms)).toHaveLength(0);
  });
});

describe("/drill failure", () => {
  it("explains that questions could not be prepared", async () => {
    const tutor: ExerciseTutor = {
      cloze: async () => [],
      judge: async () => ({ correct: false, explanation: "", tip: "" }),
      drill: async () => Promise.reject(new Error("timeout")),
      mnemonics: async () => [], story: async () => ({ title: "", body: "", questions: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "",
    };
    const h = botHarness({ tutor });
    const user = await makeUser(h.db, 100);
    await recordMistakes(h.db, user.id, [{ wrong: "go", right: "went", category: "времена" }], T0);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(h.calls.some((c) => String(c.payload.text).includes("Не получилось подготовить"))).toBe(true));
    expect(h.calls.some((c) => String(c.payload.text).includes("Что-то пошло не так"))).toBe(false);
  });
});

describe("speech text", () => {
  it("strips macOS embedded speech commands", () => {
    expect(speakableText("bank [[slnc 20000]] it")).toBe("bank slnc 20000 it");
  });
});

