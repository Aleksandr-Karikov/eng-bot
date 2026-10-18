import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs } from "../src/db/schema";
import { saveCloze } from "../src/services/cloze";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

/** Все карточки выучены и не к повторению: hangar — слабая, bank — крепкая. */
async function nothingDue(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const [term, stability] of [["bank", 30], ["hangar", 0.5]] as const) {
    const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
    if (r.status !== "saved") throw new Error("dup");
    await h.db.update(cards).set({ state: 2, stability, reps: 3, due: new Date(T0.getTime() + 5 * DAY) }).where(eq(cards.wordId, r.word.id));
  }
  return user;
}

const cardsSent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("practice outside the schedule", () => {
  it("is offered when nothing is due and warns that it doesn't count", async () => {
    const h = botHarness();
    await nothingDue(h);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(cardsSent(h).at(-1)).toContain("нечего повторять");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    const first = cardsSent(h).at(-1)!;
    expect(first).toContain("Вне зачёта");
    expect(first).toContain("hangar");
  });

  it("goes through the words without touching the schedule or the history", async () => {
    const h = botHarness();
    await nothingDue(h);
    const before = await h.db.select().from(cards);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😎 Помню")));
    expect(cardsSent(h).at(-1)).toContain("bank");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "😵 Забыл")));
    expect(cardsSent(h).at(-1)).toContain("Тренировка закончена");
    expect(await h.db.select().from(reviewLogs)).toHaveLength(0);
    expect(await h.db.select().from(cards)).toEqual(before);
  });

  it("can be stopped", async () => {
    const h = botHarness();
    await nothingDue(h);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⏹ Хватит")));
    expect(cardsSent(h).at(-1)).toContain("Тренировка закончена");
  });

  it("judges a typed fill-in-the-gap answer without rating the card", async () => {
    const judge = vi.fn(async () => ({ correct: false, explanation: "", tip: "" }));
    const h = botHarness({
      random: () => 0.99,
      tutor: { cloze: async () => [], judge, drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "" },
    });
    const user = await nothingDue(h);
    const [hangar] = await h.db.select().from(cards).where(eq(cards.userId, user.id)).orderBy(cards.stability);
    await saveCloze(h.db, hangar.wordId, [{ sentence: "Planes sleep in the ___.", answer: "hangar", translation: "" }], T0);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔁 Потренироваться")));
    expect(cardsSent(h).at(-1)).toContain("Planes sleep in the ___.");
    await h.bot.handleUpdate(h.message(100, "hangar"));
    await vi.waitFor(() => expect(cardsSent(h).some((t) => t.includes("✅ Верно"))).toBe(true));
    expect(await h.db.select().from(reviewLogs)).toHaveLength(0);
    expect(lastButtons(h.calls).length).toBeGreaterThan(0);
  });
});
