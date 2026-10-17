import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs } from "../src/db/schema";
import { trainerReport } from "../src/services/analytics";
import { recordMistakes } from "../src/services/mistakes";
import { answerCard } from "../src/services/review";
import { createRoom, joinRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { updateUser } from "../src/services/users";
import { DAY, MIN, T0, at, makeUser, testDb } from "./helpers";

describe("review log stage", () => {
  it("stores the stage of each answer", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "t", explanation: "", example: "" }, now: T0 });
    const [card] = await h.db.select().from(cards);
    await h.bot.handleUpdate(h.callback(100, `r:${card.id}:0:a`));
    await h.db.update(cards).set({ state: 2, stability: 5, due: new Date(T0.getTime() - DAY) }).where(eq(cards.id, card.id));
    const [again] = await h.db.select().from(cards);
    await h.bot.handleUpdate(h.callback(100, `r:${again.id}:${again.reps}:g`));
    expect((await h.db.select().from(reviewLogs)).map((l) => l.stage)).toEqual(["en_ru", "ru_en"]);
  });
});

describe("trainerReport", () => {
  it("summarizes forget rates by stage, first-show forgetting, hard words, people and mistake topics", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1, "Alice");
    const bob = await makeUser(db, 2, "Bob");
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    for (const term of ["bank", "hangar"]) {
      await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now: T0 });
    }
    const card = async (userId: number, term: string) => {
      const rows = await db.select().from(cards).where(eq(cards.userId, userId));
      const all = await Promise.all(rows.map(async (c) => ({ c, w: (await db.query.words.findFirst({ where: (w, { eq: e }) => e(w.id, c.wordId) }))! })));
      return all.find((x) => x.w.term === term)!.c;
    };
    const answer = async (userId: number, term: string, a: "again" | "good", stage: string, t: Date) => {
      const c = await card(userId, term);
      await answerCard(db, { userId, cardId: c.id, expectedReps: c.reps, answer: a, now: t, stage });
    };
    await answer(alice.id, "bank", "again", "en_ru", at(MIN));
    await answer(alice.id, "bank", "again", "en_ru", at(2 * MIN));
    await answer(alice.id, "bank", "good", "en_ru", at(3 * MIN));
    await answer(bob.id, "bank", "again", "en_ru", at(4 * MIN));
    await answer(bob.id, "hangar", "good", "ru_en", at(5 * MIN));
    await recordMistakes(db, bob.id, [{ wrong: "go", right: "went", category: "времена" }], T0);

    const r = await trainerReport(db, at(DAY));
    expect(r.byStage).toEqual([
      { stage: "en_ru", answers: 4, forgot: 3 },
      { stage: "ru_en", answers: 1, forgot: 0 },
    ]);
    expect(r.firstShow).toEqual({ cards: 3, forgot: 2 });
    expect(r.hardWords[0]).toMatchObject({ term: "bank", forgot: 3 });
    expect(r.people.map((p) => [p.name, p.answers])).toEqual([["Alice", 3], ["Bob", 2]]);
    expect(r.mistakeTopics).toEqual([{ category: "времена", count: 1 }]);
  });
});
