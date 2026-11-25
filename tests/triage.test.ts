import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { and, eq } from "drizzle-orm";
import type { AppCard } from "../src/app/api";
import { createApp } from "../src/app/server";
import { cards, reviewLogs } from "../src/db/schema";
import { newPortion } from "../src/services/review";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { at, makeUser, T0 } from "./helpers";

const TOKEN = "123:test-token";

async function setup(newPerDay = 1) {
  const h = botHarness();
  const me = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, newPerDay });
  const friend = await makeUser(h.db, 200, "Артём");
  const room = await createRoom(h.db, { name: "R", createdBy: friend.id, now: T0 });
  await joinRoom(h.db, { roomId: room.id, userId: me.id, now: T0, makeCurrent: true });
  const add = async (term: string, addedBy: number, offset: number) => {
    const result = await saveWord(h.db, {
      roomId: room.id, addedBy, draft: { term, translation: "перевод", explanation: "", example: "" }, now: at(offset),
    });
    if (result.status !== "saved") throw new Error(term);
    return result.word.id;
  };
  const bank = await add("bank", friend.id, 1000);
  const river = await add("river", friend.id, 2000);
  const bridge = await add("bridge", friend.id, 3000);
  await add("tree", me.id, 4000);
  h.setNow(at(5000));

  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Me" } }, TOKEN, T0)}`, "content-type": "application/json" };
  const queue = async (mode = "fresh") => {
    const res = await app.request(`/api/queue?mode=${mode}`, { headers });
    expect(res.status).toBe(200);
    return ((await res.json()) as { cards: AppCard[] }).cards;
  };
  const post = (path: string, body: object = {}) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const answer = async (cardId: number, value: string) =>
    (await post("/api/answer", { cardId, reps: 0, answer: value })).json() as Promise<{ result: string; damage: number }>;
  const cardOf = async (userId: number, wordId: number) =>
    (await h.db.select().from(cards).where(and(eq(cards.userId, userId), eq(cards.wordId, wordId))))[0];
  return { h, me, friend, bank, river, bridge, queue, post, answer, cardOf };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("первый показ новых слов друзей в Mini App", () => {
  it("даёт выбор в «Новые» и «Всё» в пределах дневной порции, в том числе при режиме только с диктантом", async () => {
    const { h, me, queue } = await setup();
    await updateUser(h.db, me.id, { modeEnRu: false, modeRuEn: false, modeListen: true });
    for (const mode of ["fresh", "all"]) {
      const cards = await queue(mode);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ needsDecision: true, stage: "en_ru", word: { term: "bank" } });
    }
    expect(await queue("reviews")).toEqual([]);
  });

  it("сохраняет старое решение и выбор «Не знаю» в чате, своё слово идёт без вопроса", async () => {
    const { h, me, bank, river, queue } = await setup(5);
    await h.db.update(cards).set({ triagedAt: T0 }).where(and(eq(cards.userId, me.id), eq(cards.wordId, bank)));
    await h.bot.handleUpdate(h.callback(100, `k:${river}:n`));
    expect((await queue()).map(({ word, needsDecision }) => [word.term, needsDecision])).toEqual([
      ["bank", undefined], ["river", undefined], ["bridge", true], ["tree", undefined],
    ]);
  });

  it("сохраняет решения, отменяет их и тратит дневную порцию только на «Учу»", async () => {
    const { h, me, friend, river, bridge, queue, post, answer, cardOf } = await setup();
    const [first] = await queue();
    expect(await answer(first.cardId, "know")).toMatchObject({ result: "ok", damage: 0 });
    expect(await newPortion(h.db, me.id, at(5000))).toMatchObject({ left: 1 });

    const [second] = await queue();
    expect(second.word.id).toBe(river);
    expect(await answer(second.cardId, "drop")).toMatchObject({ result: "ok", damage: 0 });
    expect(await cardOf(me.id, river)).toBeUndefined();
    expect(await cardOf(friend.id, river)).toBeDefined();
    expect(await newPortion(h.db, me.id, at(5000))).toMatchObject({ left: 1 });

    const [third] = await queue();
    expect(third.word.id).toBe(bridge);
    expect(await answer(third.cardId, "again")).toMatchObject({ result: "ok" });
    expect(await newPortion(h.db, me.id, at(5000))).toMatchObject({ left: 0 });
    expect(await queue()).toEqual([]);
    h.setNow(at(3 * 60_000));
    const [review] = await queue("all");
    expect(review).toMatchObject({ cardId: third.cardId, isNew: false });
    expect(review).not.toHaveProperty("needsDecision");

    expect((await post("/api/undo", { cardId: third.cardId })).status).toBe(200);
    expect((await post(`/api/words/${river}/restore`)).status).toBe(200);
    expect(await cardOf(me.id, river)).toMatchObject({ reps: 0 });
    expect((await post("/api/undo", { cardId: first.cardId })).status).toBe(200);
    expect((await queue())[0]).toMatchObject({ cardId: first.cardId, needsDecision: true });
  });

  it("не удаляет чужую карточку или карточку, которую уже начали в другой сессии", async () => {
    const { h, me, friend, bank, queue, answer, cardOf } = await setup();
    const [first] = await queue();
    const other = await cardOf(friend.id, bank);
    expect(await answer(other.id, "drop")).toMatchObject({ result: "stale" });
    expect(await cardOf(friend.id, bank)).toMatchObject({ id: other.id, reps: 0 });
    expect(await answer(first.cardId, "again")).toMatchObject({ result: "ok" });
    expect(await answer(first.cardId, "drop")).toMatchObject({ result: "stale" });
    expect(await cardOf(me.id, bank)).toMatchObject({ id: first.cardId, reps: 1 });
    expect(await h.db.select().from(reviewLogs)).toHaveLength(1);
  });
});
