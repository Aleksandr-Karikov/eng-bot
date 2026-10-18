import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards, reviewLogs, users, words } from "../src/db/schema";
import type { ExerciseTutor, Judgement } from "../src/llm/tutor";
import { listCloze, saveCloze } from "../src/services/cloze";
import { createRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const sentence = { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу реки." };

function tutor(judge: () => Promise<Judgement>, cloze = vi.fn(async () => [sentence])): ExerciseTutor {
  return { cloze, judge, drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "" };
}

/** Пользователь 100 с одним словом bank, карточка которого «выучена» на stability дней и уже к повторению. */
async function setup(h: ReturnType<typeof botHarness>, stability: number, withCloze: boolean) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, {
    roomId: room.id,
    addedBy: user.id,
    draft: { term: "bank", translation: "берег", explanation: "край реки", example: "the river bank", transcriptionUk: "/bæŋk/" },
    now: new Date(T0.getTime() - 30 * DAY),
  });
  if (r.status !== "saved") throw new Error("dup");
  await h.db.update(cards).set({ state: 2, stability, reps: 4, due: new Date(T0.getTime() - DAY) });
  if (withCloze) await saveCloze(h.db, r.word.id, [sentence], T0);
  const [card] = await h.db.select().from(cards);
  return { user, word: r.word, card };
}

const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
const lastRating = async (h: ReturnType<typeof botHarness>) => (await h.db.select().from(reviewLogs)).at(-1)?.rating;

describe("trainer ladder", () => {
  it("can show RU → EN for a word that was already seen", async () => {
    const h = botHarness({ random: () => 0.99 });
    await setup(h, 5, false);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const text = sent(h).at(-1)!;
    expect(text).toMatch(/^🇷🇺 <b>берег<\/b>/);
    expect(text).toContain("<tg-spoiler><b>bank</b>");
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("😎 Помню");
  });

  it("cloze: an exact answer counts as «Помню» and does not add a word", async () => {
    const judge = vi.fn(async () => ({ correct: false, explanation: "", tip: "" }));
    const h = botHarness({ tutor: tutor(judge), random: () => 0.99 });
    await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(sent(h).at(-1)).toContain("We sat on the ___ of the river.");
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("🤷 Не знаю");

    await h.bot.handleUpdate(h.message(100, "Bank!"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("✅ Верно"))).toBe(true));
    expect(judge).not.toHaveBeenCalled();
    expect(await lastRating(h)).toBe("good");
    expect(await h.db.select().from(words)).toHaveLength(1);
  });

  it("cloze: Claude accepts a synonym with an explanation", async () => {
    const h = botHarness({ tutor: tutor(async () => ({ correct: true, explanation: "shore тоже подходит", tip: "" })), random: () => 0.99 });
    await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.message(100, "shore"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("✅ Засчитано") && t.includes("shore тоже подходит"))).toBe(true));
    expect(await lastRating(h)).toBe("good");
  });

  it("cloze: a wrong answer shows the right one, why and a tip, and counts as «Забыл»", async () => {
    const h = botHarness({ tutor: tutor(async () => ({ correct: false, explanation: "bench — скамейка", tip: "bank ≈ берег" })), random: () => 0.99 });
    await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.message(100, "bench"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.startsWith("❌"))).toBe(true));
    const feedback = sent(h).find((t) => t.startsWith("❌"))!;
    expect(feedback).toContain("We sat on the <b>bank</b> of the river.");
    expect(feedback).toContain("bench — скамейка");
    expect(feedback).toContain("bank ≈ берег");
    expect(await lastRating(h)).toBe("again");
  });

  it("cloze: if Claude fails, shows the answer and lets you rate yourself", async () => {
    const h = botHarness({ tutor: tutor(async () => Promise.reject(new Error("timeout"))), random: () => 0.99 });
    await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.message(100, "bench"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Не получилось проверить"))).toBe(true));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("😎 Помню");
    expect(await lastRating(h)).toBeUndefined();
  });

  it("cloze: «Не знаю» shows the answer and counts as «Забыл»", async () => {
    const h = botHarness({ random: () => 0.99 });
    await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🤷 Не знаю")));
    expect(await lastRating(h)).toBe("again");
    expect(h.calls.some((c) => c.method === "editMessageText" && String(c.payload.text).includes("<b>bank</b>"))).toBe(true);
  });

  it("falls back to another mode and prepares sentences in the background when none exist yet", async () => {
    const cloze = vi.fn(async () => [sentence]);
    const h = botHarness({ tutor: tutor(async () => ({ correct: false, explanation: "", tip: "" }), cloze), random: () => 0.99 });
    const { word } = await setup(h, 20, false);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(sent(h).at(-1)).toMatch(/^🇷🇺/);
    await vi.waitFor(async () => expect(await listCloze(h.db, word.id)).toHaveLength(1));
    expect(cloze).toHaveBeenCalledWith("bank", "берег");
  });

  it("after ✏️ on a cloze card the next message is the fix, not the answer", async () => {
    const judge = vi.fn(async () => ({ correct: false, explanation: "", tip: "" }));
    const h = botHarness({ tutor: tutor(judge), random: () => 0.99 });
    const { word } = await setup(h, 20, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.manage(100));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✏️ Изменить")));
    await h.bot.handleUpdate(h.message(100, "берег реки"));
    await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Обновлено"))).toBe(true));
    expect(judge).not.toHaveBeenCalled();
    expect((await h.db.select().from(words).where(eq(words.id, word.id)))[0].translation).toBe("берег реки");
  });

  it("respects disabled modes", async () => {
    const cloze = vi.fn(async () => [sentence]);
    const h = botHarness({ tutor: tutor(async () => ({ correct: false, explanation: "", tip: "" }), cloze), random: () => 0.99 });
    const { user } = await setup(h, 20, true);
    await updateUser(h.db, user.id, { modeCloze: false, modeRuEn: false });
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(sent(h).at(-1)).toMatch(/^<b>bank<\/b>/);
    expect(cloze).not.toHaveBeenCalled();
  });
});

describe("/settings modes", () => {
  it("toggles modes and refuses to turn off the last one", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/settings"));
    expect(lastButtons(h.calls).map((b) => b.text)).toEqual(expect.arrayContaining(["✅ EN → RU", "✅ RU → EN", "✅ Вставь по смыслу"]));

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ RU → EN")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Вставь по смыслу")));
    expect(await getUser(h.db, user.id)).toMatchObject({ modeEnRu: true, modeRuEn: false, modeCloze: false });
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("⬜️ RU → EN");

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ EN → RU")));
    expect((await getUser(h.db, user.id))?.modeEnRu).toBe(true);
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("Хотя бы один");
    void users;
  });
});
