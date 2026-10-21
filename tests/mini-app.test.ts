import { describe, expect, it } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { cards, reviewLogs } from "../src/db/schema";
import { createApp } from "../src/app/server";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const TOKEN = "123:test-token";

async function setup() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "", usefulness: 3 }, now: T0 });
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const auth = { authorization: `tma ${sign({ user: { id: 100, first_name: "User100" } }, TOKEN, new Date())}` };
  return { h, app, auth };
}

describe("📚 Mini App API", () => {
  it("knows the user only by Telegram's signed init data", async () => {
    const { app, auth } = await setup();
    expect((await app.request("/api/me")).status).toBe(401);
    const forged = `tma ${sign({ user: { id: 100, first_name: "X" } }, "999:other", new Date())}`;
    expect((await app.request("/api/me", { headers: { authorization: forged } })).status).toBe(401);
    const me = await (await app.request("/api/me", { headers: auth })).json();
    expect(me).toMatchObject({ ok: true, name: "User100", room: "R", due: { review: 0, fresh: 1 } });
  });

  it("gives the /learn queue and takes answers like the bot does", async () => {
    const { h, app, auth } = await setup();
    const { cards: queue } = await (await app.request("/api/queue", { headers: auth })).json();
    expect(queue).toMatchObject([{ isNew: true, stage: "en_ru", word: { term: "bank", translation: "берег", usefulness: 3 } }]);
    const answer = (body: object) => app.request("/api/answer", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(await (await answer({ cardId: queue[0].cardId, reps: 0, answer: "good", stage: "en_ru" })).json()).toEqual({ ok: true, result: "ok" });
    expect(await (await answer({ cardId: queue[0].cardId, reps: 0, answer: "good", stage: "en_ru" })).json()).toEqual({ ok: true, result: "stale" });
    expect((await h.db.select().from(reviewLogs)).map((l) => l.stage)).toEqual(["app_en_ru"]);
    expect((await answer({ cardId: queue[0].cardId, reps: 1, answer: "hack" })).status).toBe(400);
    void cards;
  });

  it("opens at /app without a trailing slash too", async () => {
    const { app } = await setup();
    const res = await app.request("/app");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/");
  });

  it("serves audio only for your own cards", async () => {
    const { app, auth } = await setup();
    expect((await app.request("/api/audio?card=999&accent=uk", { headers: auth })).status).toBe(404);
  });
});
