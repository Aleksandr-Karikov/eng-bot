import { describe, expect, it } from "vitest";
import { cards, words } from "../src/db/schema";
import { draftText } from "../src/bot/texts";
import { createRoom } from "../src/services/rooms";
import { nextDue } from "../src/services/review";
import { updateUser } from "../src/services/users";
import { getWord, saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

async function room(h: ReturnType<typeof botHarness>, list: Array<[string, number | null]>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const r = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const [term, usefulness] of list) {
    await saveWord(h.db, { roomId: r.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "", usefulness }, now: T0 });
  }
  return user;
}

describe("how useful a word is", () => {
  it("is shown on the draft with its reasons", () => {
    expect(draftText({ term: "pay off", translation: "окупаться", explanation: "", example: "", usefulness: 3, usefulnessNote: "частое выражение" })).toContain("🟢 Очень полезное: частое выражение");
    expect(draftText({ term: "feign", translation: "притворяться", explanation: "", example: "", usefulness: 1, usefulnessNote: "редкое слово" })).toContain("⚪️ Необязательное — учим только на узнавание: редкое слово");
  });

  it("new words come most useful first", async () => {
    const h = botHarness();
    const user = await room(h, [["trump the kipper", 1], ["prudent", 2], ["pay off", 3], ["unrated", null]]);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const item = (await nextDue(h.db, user.id, T0))!;
      order.push(item.word.term);
      await h.db.update(cards).set({ due: new Date(T0.getTime() + 30 * DAY) }).where((await import("drizzle-orm")).eq(cards.id, item.card.id));
    }
    expect(order).toEqual(["pay off", "prudent", "unrated", "trump the kipper"]);
  });

  it("an optional word is only for recognition, until someone makes it useful", async () => {
    const h = botHarness({ random: () => 0.99 });
    const user = await room(h, [["trump the kipper", 1]]);
    await h.db.update(cards).set({ state: 2, stability: 5, reps: 5, due: new Date(T0.getTime() - DAY) });
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const sent = () => String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    expect(sent()).toContain("Вспомни перевод"); // EN → RU, хотя выпал бы последний режим
    expect(sent()).toContain("⚪️ Необязательное");
    await h.bot.handleUpdate(h.manage(100));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⭐ Сделать полезным")));
    expect((await getWord(h.db, 1))?.usefulness).toBe(2);
    await h.bot.handleUpdate(h.manage(100, "▴"));
    await h.bot.handleUpdate(h.manage(100));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("✏️ Изменить");
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("⭐ Сделать полезным — учить полностью");
    void user;
    void words;
  });
});
