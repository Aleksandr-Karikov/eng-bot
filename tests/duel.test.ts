import { describe, expect, it, vi } from "vitest";
import { digestText } from "../src/bot/texts";
import { buildDuelRound, recordDuelPoint, weeklyDuelPoints } from "../src/services/duels";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, type ApiCall } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

const GROUP = -700;
type Button = { text: string; callback_data: string };

async function room(db: ReturnType<typeof testDb>, terms: string[], telegramChatId?: number) {
  const alice = await updateUser(db, (await makeUser(db, 100, "Alice")).id, { canDm: true });
  const bob = await updateUser(db, (await makeUser(db, 200, "Bob")).id, { canDm: true });
  const r = await createRoom(db, { name: "R", createdBy: alice.id, now: T0, telegramChatId });
  await joinRoom(db, { roomId: r.id, userId: bob.id, now: T0, makeCurrent: true });
  for (const term of terms) {
    await saveWord(db, { roomId: r.id, addedBy: alice.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
  }
  return { alice, bob, room: r };
}

/** Последний вопрос раунда и его кнопки. */
function lastRound(calls: ApiCall[]) {
  const call = [...calls].reverse().find((c) => c.method === "sendMessage" && String(c.payload.text).includes("Раунд"))!;
  const text = String(call.payload.text);
  const term = /Что значит <b>(.+?)<\/b>/.exec(text)![1];
  const buttons = (call.payload.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard.flat();
  return { text, term, right: buttons.find((b) => b.text === `t-${term}`)!, wrong: buttons.find((b) => b.text !== `t-${term}`)! };
}
const texts = (calls: ApiCall[]) => calls.map((c) => String(c.payload.text ?? ""));
const answers = (calls: ApiCall[]) => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));

describe("buildDuelRound", () => {
  it("offers 4 translations from the room, preferring distractors of the same kind", async () => {
    const db = testDb();
    const { room: r } = await room(db, ["bank", "hangar", "prudent", "rot", "take it for granted", "spill the beans"]);
    for (let i = 0; i < 20; i++) {
      const round = (await buildDuelRound(db, r.id, Math.random))!;
      expect(round.options).toHaveLength(4);
      expect(new Set(round.options).size).toBe(4);
      expect(round.options[round.correct]).toBe(`t-${round.term}`);
      if (!round.term.includes(" ")) expect(round.options.filter((o) => o.includes(" "))).toHaveLength(0);
    }
  });

  it("needs at least 4 words", async () => {
    const db = testDb();
    const { room: r } = await room(db, ["a", "b", "c"]);
    expect(await buildDuelRound(db, r.id, Math.random)).toBeUndefined();
  });
});

describe("/duel", () => {
  it("first correct answer wins the round; a wrong answer locks you out for that round", async () => {
    const h = botHarness();
    const { room: r } = await room(h.db, ["bank", "hangar", "prudent", "rot"], GROUP);
    await h.bot.handleUpdate(h.groupMessage(100, GROUP, "/duel"));
    const round1 = lastRound(h.calls);
    expect(round1.text).toContain("Раунд 1/5");

    await h.bot.handleUpdate(h.groupCallback(100, GROUP, round1.wrong.callback_data));
    expect(answers(h.calls).at(-1)).toContain("Мимо");
    await h.bot.handleUpdate(h.groupCallback(100, GROUP, round1.right.callback_data));
    expect(answers(h.calls).at(-1)).toContain("уже отвечал");
    await h.bot.handleUpdate(h.groupCallback(200, GROUP, round1.right.callback_data));
    expect(texts(h.calls).some((t) => t.includes("User200") && t.includes(round1.term))).toBe(true);
    expect(lastRound(h.calls).text).toContain("Раунд 2/5");

    await h.bot.handleUpdate(h.groupCallback(200, GROUP, round1.right.callback_data));
    expect(answers(h.calls).at(-1)).toContain("закончился");
    expect((await weeklyDuelPoints(h.db, r.id, T0)).map((p) => [p.name, p.points])).toEqual([["User200", 1]]);
  });

  it("moves on when nobody answers in time and ends with a scoreboard", async () => {
    const h = botHarness({ duelRoundMs: 30 });
    await room(h.db, ["bank", "hangar", "prudent", "rot"], GROUP);
    await h.bot.handleUpdate(h.groupMessage(100, GROUP, "/duel"));
    await h.bot.handleUpdate(h.groupCallback(100, GROUP, lastRound(h.calls).right.callback_data));
    await vi.waitFor(() => expect(texts(h.calls).some((t) => t.includes("Никто не угадал"))).toBe(true));
    await vi.waitFor(() => expect(texts(h.calls).some((t) => t.includes("Итоги дуэли"))).toBe(true), { timeout: 3000 });
    const final = texts(h.calls).find((t) => t.includes("Итоги дуэли"))!;
    expect(final).toContain("User100");
    expect(final).toContain("🏆");
  });

  it("refuses with too few words, or while a duel is already running", async () => {
    const small = botHarness();
    await room(small.db, ["bank", "hangar"], GROUP);
    await small.bot.handleUpdate(small.groupMessage(100, GROUP, "/duel"));
    expect(texts(small.calls).some((t) => t.includes("хотя бы 4"))).toBe(true);

    const h = botHarness();
    await room(h.db, ["bank", "hangar", "prudent", "rot"], GROUP);
    await h.bot.handleUpdate(h.groupMessage(100, GROUP, "/duel"));
    await h.bot.handleUpdate(h.groupMessage(200, GROUP, "/duel"));
    expect(texts(h.calls).some((t) => t.includes("уже идёт"))).toBe(true);
  });
});

describe("duel points in the digest", () => {
  it("sums the week's points per member and shows them", async () => {
    const db = testDb();
    const { alice, bob, room: r } = await room(db, []);
    await recordDuelPoint(db, r.id, bob.id, T0);
    await recordDuelPoint(db, r.id, bob.id, T0);
    await recordDuelPoint(db, r.id, alice.id, T0);
    const points = await weeklyDuelPoints(db, r.id, T0);
    expect(points.map((p) => [p.name, p.points])).toEqual([["Bob", 2], ["Alice", 1]]);
    const text = digestText("R", [{ name: "Bob", added: 0, reviews7d: 1, learned: 0, streak: 0 }], points);
    expect(text).toContain("⚔️ Дуэли: Bob 2 · Alice 1");
  });
});
