import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs } from "../src/db/schema";
import { answerCard, undoAnswer } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

async function setup() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  const [card] = await h.db.select().from(cards);
  return { h, user, card };
}

describe("↩️ undo an answer", () => {
  it("puts the card back exactly as it was and forgets the answer", async () => {
    const { h, user, card } = await setup();
    await answerCard(h.db, { userId: user.id, cardId: card.id, expectedReps: 0, answer: "again", now: T0 });
    expect((await h.db.select().from(cards))[0].reps).toBe(1);
    expect(await undoAnswer(h.db, { userId: user.id, cardId: card.id })).toEqual({ rating: "again" });
    const [after] = await h.db.select().from(cards).where(eq(cards.id, card.id));
    expect({ ...after }).toEqual({ ...card });
    expect(await h.db.select().from(reviewLogs)).toEqual([]);
    // Теперь можно ответить заново — как будто первого ответа не было.
    expect(await answerCard(h.db, { userId: user.id, cardId: card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("ok");
  });

  it("undoes only the last answer, once, and never someone else's", async () => {
    const { h, user, card } = await setup();
    await answerCard(h.db, { userId: user.id, cardId: card.id, expectedReps: 0, answer: "good", now: T0 });
    expect(await undoAnswer(h.db, { userId: 999, cardId: card.id })).toBeUndefined();
    expect(await undoAnswer(h.db, { userId: user.id, cardId: card.id })).toEqual({ rating: "good" });
    expect(await undoAnswer(h.db, { userId: user.id, cardId: card.id })).toBeUndefined();
  });

  it("an old answer without a snapshot cannot be undone", async () => {
    const { h, user, card } = await setup();
    await h.db.insert(reviewLogs).values({ userId: user.id, cardId: card.id, rating: "good", reviewedAt: T0 });
    expect(await undoAnswer(h.db, { userId: user.id, cardId: card.id })).toBeUndefined();
  });

  it("in /learn the next card offers «↩️ Отменить «Забыл»» and brings the card back to rate again", async () => {
    const { h, user } = await setup();
    await saveWord(h.db, { roomId: 1, addedBy: user.id, draft: { term: "river", translation: "река", explanation: "", example: "" }, now: T0 });
    const sent = () => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const first = sent().at(-1)!;
    const firstTerm = first.includes("bank") ? "bank" : "river";
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😵 Забыл")));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("↩️ Отменить «Забыл»");
    expect(await h.db.select().from(reviewLogs)).toHaveLength(1);

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "↩️ Отменить «Забыл»")));
    expect(sent().at(-1)).toContain(firstTerm);
    expect(await h.db.select().from(reviewLogs)).toEqual([]);
    // Снова оценить — уже правильной кнопкой; кнопка отмены теперь про неё.
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😎 Помню")));
    expect((await h.db.select().from(reviewLogs)).map((l) => l.rating)).toEqual(["good"]);
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("↩️ Отменить «Помню»");
  });

  it("the last card of the session can be undone from «Готово»", async () => {
    const { h } = await setup();
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😵 Забыл")));
    // Забытая новая карточка вернётся сегодня же, но не сразу — сейчас экран «Готово» с отменой.
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("↩️ Отменить «Забыл»");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "↩️ Отменить «Забыл»")));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("😎 Помню");
  });
});
