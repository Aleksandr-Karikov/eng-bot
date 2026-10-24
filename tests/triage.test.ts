import { describe, expect, it } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { and, eq } from "drizzle-orm";
import { State } from "ts-fsrs";
import { cards } from "../src/db/schema";
import { createApp } from "../src/app/server";
import { createRoom, joinRoom } from "../src/services/rooms";
import { triageQueue } from "../src/services/triage";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const TOKEN = "123:test-token";

/** Я (100) и Артём (200) в одной комнате; Артём добавил bank и river, я — tree. */
async function setup() {
  const h = botHarness();
  const me = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const artem = await updateUser(h.db, (await makeUser(h.db, 200, "Артём")).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: artem.id, now: T0 });
  await joinRoom(h.db, { roomId: room.id, userId: me.id, now: T0, makeCurrent: true });
  const add = async (term: string, by: number, minute: number) => {
    const r = await saveWord(h.db, { roomId: room.id, addedBy: by, draft: { term, translation: term, explanation: "", example: "" }, now: new Date(T0.getTime() + minute * 60_000) });
    if (r.status !== "saved") throw new Error(term);
    return r.word;
  };
  const bank = await add("bank", artem.id, 1);
  const river = await add("river", artem.id, 2);
  await add("tree", me.id, 3);
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const auth = { authorization: `tma ${sign({ user: { id: 100, first_name: "Me" } }, TOKEN, new Date())}`, "content-type": "application/json" };
  return { h, me, bank, river, app, auth };
}

const myCard = async (h: ReturnType<typeof botHarness>, userId: number, wordId: number) =>
  (await h.db.select().from(cards).where(and(eq(cards.userId, userId), eq(cards.wordId, wordId))))[0];

describe("🆕 new words from friends, a swipe each", () => {
  it("the deck has friends' new words only, oldest first", async () => {
    const { h, me } = await setup();
    expect((await triageQueue(h.db, me.id)).map((i) => [i.word.term, i.addedBy])).toEqual([["bank", "Артём"], ["river", "Артём"]]);
  });

  it("learn / know / not for me — and each can be undone", async () => {
    const { h, me, bank, river, app, auth } = await setup();
    const post = (body: object) => app.request("/api/triage", { method: "POST", headers: auth, body: JSON.stringify(body) });
    const bankCard = await myCard(h, me.id, bank.id);
    const riverCard = await myCard(h, me.id, river.id);

    expect((await post({ cardId: bankCard.id, action: "know" })).status).toBe(200);
    expect((await myCard(h, me.id, bank.id)).state).not.toBe(State.New);
    expect((await post({ cardId: bankCard.id, action: "know" })).status).toBe(409);
    await post({ cardId: bankCard.id, action: "know", undo: true });
    expect(await myCard(h, me.id, bank.id)).toMatchObject({ state: State.New, reps: 0, triagedAt: null });

    await post({ cardId: riverCard.id, action: "drop" });
    expect(await myCard(h, me.id, river.id)).toBeUndefined();
    await post({ cardId: riverCard.id, wordId: river.id, action: "drop", undo: true });
    expect(await myCard(h, me.id, river.id)).toBeDefined();

    await post({ cardId: bankCard.id, action: "learn" });
    const me2 = await (await app.request("/api/me", { headers: auth })).json();
    expect(me2.triage).toBe(1);
    const { cards: deck } = await (await app.request("/api/triage", { headers: auth })).json();
    expect(deck.map((c: { word: { term: string } }) => c.word.term)).toEqual(["river"]);
  });

  it("«📚 Не знаю» in the chat counts as decided", async () => {
    const { h, me } = await setup();
    await h.bot.handleUpdate(h.callback(100, `k:1:n`));
    expect((await triageQueue(h.db, me.id)).map((i) => i.word.term)).toEqual(["river"]);
  });
});
