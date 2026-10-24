import { describe, expect, it } from "vitest";
import { cards } from "../src/db/schema";
import { recordDrillAnswer, recordMistakes } from "../src/services/mistakes";
import { progressReport } from "../src/services/progress";
import { answerCard } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { localParts } from "../src/time";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("📊 progress", () => {
  it("counts today's answers, a forecast without new words, the goal and open mistake topics", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    for (const term of ["bank", "river", "tree"]) await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: term, explanation: "", example: "" }, now: T0 });
    const [first, second] = await h.db.select().from(cards);
    await answerCard(h.db, { userId: user.id, cardId: first.id, expectedReps: 0, answer: "good", now: T0 });
    await answerCard(h.db, { userId: user.id, cardId: second.id, expectedReps: 0, answer: "again", now: T0 });
    await recordMistakes(h.db, user.id, [{ wrong: "a", right: "the", category: "артикли" }, { wrong: "on", right: "in", category: "предлоги" }, { wrong: "an", right: "the", category: "артикли" }], T0);
    await recordDrillAnswer(h.db, user.id, "артикли", true, new Date(T0.getTime() + 1000));

    const r = await progressReport(h.db, user, room, new Date(T0.getTime() + 60_000));
    expect(r.calendar).toHaveLength(84);
    expect(r.calendar.at(-1)).toEqual({ date: localParts(user.timezone, T0).date, count: 2 });
    expect(r.started7d).toBe(2);
    expect(r.forecast).toHaveLength(7);
    // Ответили на две карточки — в прогнозе только они, третья (новая) не считается.
    expect(r.forecast.reduce((a, d) => a + d.count, 0)).toBe(2);
    expect(r.goal).toMatchObject({ room: "R", done: 2 });
    expect(r.topics).toEqual([
      { category: "артикли", count: 2, streak: 1 },
      { category: "предлоги", count: 1, streak: 0 },
    ]);
    expect(r.resolveStreak).toBe(3);
  });
});
