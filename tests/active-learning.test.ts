import { sign } from "@telegram-apps/init-data-node";
import { eq } from "drizzle-orm";
import { State } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCard } from "../src/app/api";
import { createApp } from "../src/app/server";
import { cards } from "../src/db/schema";
import { countDueSplit } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { isLearned } from "../src/services/stats";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { newCard, review } from "../src/srs/srs";
import { botHarness, buttonData } from "./bot-harness";
import { at, DAY, makeUser, T0 } from "./helpers";

const DEFAULT_LIMIT = 15;

async function setup(started: number) {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { newPerDay: 0, modeDrill: false });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (let index = 0; index < started + 3; index++) {
    await saveWord(h.db, {
      roomId: room.id, addedBy: user.id, now: T0,
      draft: { term: `word ${index}`, translation: "перевод", explanation: "", example: "" },
    });
  }
  const rows = await h.db.select().from(cards).orderBy(cards.id);
  const learning = review(newCard(T0).fsrs, "good", T0);
  for (const card of rows.slice(0, started)) {
    await h.db.update(cards).set(learning).where(eq(cards.id, card.id));
  }

  const token = "123:test-token";
  const app = createApp({ deps: h.deps, botToken: token });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Me" } }, token, T0)}`, "content-type": "application/json" };
  const queue = async (mode = "fresh") => {
    const res = await app.request(`/api/queue?mode=${mode}`, { headers });
    expect(res.status).toBe(200);
    return ((await res.json()) as { cards: AppCard[] }).cards;
  };
  const post = (path: string, body: object) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const answer = async (cardId: number, value: string, reps = 0) => {
    const res = await post("/api/answer", { cardId, reps, answer: value });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ result: string; damage: number }>;
  };
  const getCard = async (id: number) => (await h.db.select().from(cards).where(eq(cards.id, id)))[0];
  return { h, user, rows, queue, answer, post, getCard };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("лимит одновременно изучаемых слов", () => {
  it("держит новые после смены суток, освобождает место по FSRS и допускает один ответ на последнее место", async () => {
    const { h, user, rows, queue, answer, post, getCard } = await setup(DEFAULT_LIMIT);
    await updateUser(h.db, user.id, { newPerDay: 5 });
    h.setNow(at(DAY));
    expect(await queue()).toEqual([]);
    expect(await queue("reviews")).toHaveLength(DEFAULT_LIMIT);
    expect(await countDueSplit(h.db, user.id, at(DAY))).toMatchObject({ fresh: 0, waiting: 3, activeFull: true });

    const first = rows[0].id;
    expect(await answer(first, "easy", 1)).toMatchObject({ result: "ok" });
    h.setNow((await getCard(first)).due);
    expect(await answer(first, "easy", 2)).toMatchObject({ result: "ok" });
    expect(isLearned(await getCard(first))).toBe(true);
    const [newWord, other] = rows.slice(DEFAULT_LIMIT);
    expect((await queue()).map((card) => card.cardId)).toEqual([newWord.id]);

    const results = await Promise.all([answer(newWord.id, "good"), answer(other.id, "good")]);
    expect(results.map(({ result }) => result).sort()).toEqual(["ok", "waiting"]);
    expect(await queue()).toEqual([]);

    const waiting = results[0].result === "waiting" ? newWord : other;
    const rejected = await post("/api/check", { cardId: waiting.id, reps: 0, stage: "listen", dunno: true });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: "Места в обучении заняты. Слово осталось в очереди." });
    expect((await getCard(waiting.id)).reps).toBe(0);
  });

  it("оставляет место после «Уже знаю» и объясняет ожидание в боте", async () => {
    const { h, rows, queue, answer } = await setup(DEFAULT_LIMIT - 1);
    const [known, next] = rows.slice(DEFAULT_LIMIT - 1);
    expect(await answer(known.id, "know")).toMatchObject({ result: "ok" });
    expect((await queue()).map((card) => card.cardId)).toEqual([next.id]);
    expect(await answer(next.id, "good")).toMatchObject({ result: "ok" });

    await h.db.update(cards).set({ due: at(DAY) }).where(eq(cards.state, State.Learning));
    h.setNow(T0);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(h.calls.filter(({ method }) => method === "sendMessage").at(-1)?.payload).toMatchObject({
      text: expect.stringContaining("Новые слова появятся, когда освободится место в обучении."),
    });
  });

  it("показывает все повторы из уже накопившейся очереди, даже если они превысили лимит", async () => {
    const { h, queue } = await setup(DEFAULT_LIMIT + 1);
    h.setNow(T0);
    expect(await queue()).toEqual([]);
    expect(await queue("all")).toHaveLength(DEFAULT_LIMIT + 1);
  });

  it("меняет личный предел из бота и Mini App, сохраняя начатые карточки и дневную порцию", async () => {
    const { h, user, queue, post, rows, answer } = await setup(DEFAULT_LIMIT);
    expect(user.activeLearningLimit).toBe(15);
    expect(await queue()).toEqual([]);

    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "📚 Слов одновременно")));
    expect(buttonData(h.calls, "✅ 15")).toBeTruthy();
    await h.bot.handleUpdate(h.callback(100, "al:999"));
    expect(h.calls.at(-1)?.payload.text).toBe("Нет такого варианта");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⬜️ 20")));
    expect(await queue()).toHaveLength(3);
    expect(await answer(rows[DEFAULT_LIMIT].id, "good")).toMatchObject({ result: "ok" });

    expect((await post("/api/settings", { activeLearningLimit: 0 })).status).toBe(400);
    const changed = await post("/api/settings", { activeLearningLimit: 10 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ settings: { activeLearningLimit: 10, activeLearningChoices: [10, 15, 20, 30], newPerDay: 0 } });
    expect(await queue()).toEqual([]);
    h.setNow(at(DAY));
    expect(await queue("reviews")).toHaveLength(DEFAULT_LIMIT + 1);
  });
});
