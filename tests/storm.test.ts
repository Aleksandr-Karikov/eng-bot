import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { isStormHard, markStormStarted, stormCandidates } from "../src/services/storm";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

describe("optional word storm", () => {
  it("stops calling a word difficult after two ordinary successes and reopens on a new failure", () => {
    const ratings = ["again", "again", "again", "again"];
    expect(isStormHard(ratings)).toBe(true);
    expect(isStormHard([...ratings, "good"])).toBe(true);
    expect(isStormHard([...ratings, "good", "good"])).toBe(false);
    expect(isStormHard([...ratings, "good", "good", "again"])).toBe(true);
  });

  it("offers after four failures, waits for a new failure after a storm, and retires after two ordinary successes", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const ids: number[] = [];
    for (const [term, usefulness] of [["bank", 3], ["river", 3], ["hangar", 3], ["optional", 1]] as const) {
      const result = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "", usefulness }, now: T0 });
      if (result.status !== "saved") throw new Error(result.status);
      const [card] = await h.db.select().from(cards).where(eq(cards.wordId, result.word.id));
      ids.push(card.id);
      await h.db.update(cards).set({ state: 2, reps: 4, due: new Date(T0.getTime() + DAY) }).where(eq(cards.id, card.id));
      for (let i = 0; i < 4; i++) await h.db.insert(reviewLogs).values({ userId: user.id, cardId: card.id, rating: "again", reviewedAt: T0 });
    }
    const before = await h.db.select().from(cards);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(buttonData(h.calls, "🧠 Штурм 3 трудных слов")).toBe("ps");
    await h.bot.handleUpdate(h.callback(100, "ps"));
    expect(await stormCandidates(h.db, user.id)).toHaveLength(3);
    const oldAnswer = buttonData(h.calls, "😵 Забыл");
    await h.bot.handleUpdate(h.callback(100, oldAnswer));
    for (let i = 0; i < 2; i++) await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😎 Помню")));
    const sentBeforeReplay = h.calls.filter((c) => c.method === "sendMessage").length;
    await h.bot.handleUpdate(h.callback(100, oldAnswer));
    expect(h.calls.filter((c) => c.method === "sendMessage")).toHaveLength(sentBeforeReplay);
    for (let i = 0; i < 4; i++) await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😎 Помню")));
    expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("Штурм закончен"))).toBe(true);
    expect(await stormCandidates(h.db, user.id)).toEqual([]);
    expect(await h.db.select().from(cards)).toEqual(before);
    expect(await h.db.select().from(reviewLogs)).toHaveLength(16);

    await h.db.insert(reviewLogs).values({ userId: user.id, cardId: ids[0], rating: "again", reviewedAt: T0 });
    expect((await stormCandidates(h.db, user.id)).map((c) => c.cardId)).toEqual([ids[0]]);
    await markStormStarted(h.db, await stormCandidates(h.db, user.id));
    await h.db.insert(reviewLogs).values({ userId: user.id, cardId: ids[0], rating: "good", reviewedAt: T0 });
    await h.db.insert(reviewLogs).values({ userId: user.id, cardId: ids[0], rating: "good", reviewedAt: T0 });
    expect(await stormCandidates(h.db, user.id)).toEqual([]);
  });
});
