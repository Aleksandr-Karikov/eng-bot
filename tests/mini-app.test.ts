import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { CaptureBroadcaster } from "../src/capture/capture";
import { startCaptureServer } from "../src/capture/server";
import { sign } from "@telegram-apps/init-data-node";
import { cards, reviewLogs } from "../src/db/schema";
import { createApp } from "../src/app/server";
import { createRoom } from "../src/services/rooms";
import { getUser } from "../src/services/users";
import { getWord } from "../src/services/words";
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

  it("passes /ext/… through to the extension server, so one tunnel serves both", async () => {
    const { h } = await setup();
    await updateUser(h.db, 1, { captureKey: "k1" });
    const server = startCaptureServer(h.deps, new CaptureBroadcaster(h.deps, 60_000), 0);
    try {
      await new Promise((r) => server.once("listening", r));
      h.deps.capturePort = (server.address() as AddressInfo).port;
      const app = createApp({ deps: h.deps, botToken: TOKEN });
      expect(await (await app.request("/ext/ping?key=k1")).json()).toMatchObject({ ok: true, name: "User100" });
      expect((await app.request("/ext/ping?key=wrong")).status).toBe(401);
      const post = await app.request("/ext/example", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "k1", wordId: 999, context: "x" }) });
      expect(post.status).not.toBe(401);
    } finally {
      server.close();
    }
  });

  describe("📖 words and ⚙️ settings", () => {
    const post = (app: Awaited<ReturnType<typeof setup>>["app"], auth: object, path: string, body: object = {}) =>
      app.request(path, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });

    it("lists the room's words with my status and opens one", async () => {
      const { app, auth } = await setup();
      const list = await (await app.request("/api/words", { headers: auth })).json();
      expect(list).toMatchObject({ ok: true, room: "R", words: [{ term: "bank", translation: "берег", status: "new", usefulness: 3 }] });
      const { word } = await (await app.request(`/api/words/${list.words[0].id}`, { headers: auth })).json();
      expect(word).toMatchObject({ term: "bank", mine: true, collocations: [], moreContexts: [] });
    });

    it("edits, drops and restores, promotes and deletes like the bot's buttons", async () => {
      const { h, app, auth } = await setup();
      const id = (await (await app.request("/api/words", { headers: auth })).json()).words[0].id;
      expect((await post(app, auth, `/api/words/${id}/edit`, { translation: "" })).status).toBe(400);
      expect((await post(app, auth, `/api/words/${id}/edit`, { translation: "банк", explanation: "финансы" })).status).toBe(200);
      expect(await getWord(h.db, id)).toMatchObject({ translation: "банк", explanation: "финансы" });
      await post(app, auth, `/api/words/${id}/drop`);
      expect((await (await app.request("/api/words", { headers: auth })).json()).words[0].status).toBe("dropped");
      await post(app, auth, `/api/words/${id}/restore`);
      expect((await (await app.request("/api/words", { headers: auth })).json()).words[0].status).toBe("new");
      await post(app, auth, `/api/words/${id}/promote`);
      expect((await getWord(h.db, id))!.usefulness).toBe(2);
      expect((await post(app, auth, `/api/words/${id}/hack`)).status).toBe(400);
      await post(app, auth, `/api/words/${id}/delete`);
      expect(await getWord(h.db, id)).toBeUndefined();
      expect((await app.request(`/api/words/${id}`, { headers: auth })).status).toBe(404);
    });

    it("does not show or change words of rooms I am not in", async () => {
      const { h, app, auth } = await setup();
      const stranger = await makeUser(h.db, 300);
      const other = await createRoom(h.db, { name: "Other", createdBy: stranger.id, now: T0 });
      const saved = await saveWord(h.db, { roomId: other.id, addedBy: stranger.id, draft: { term: "secret", translation: "секрет", explanation: "", example: "" }, now: T0 });
      if (saved.status !== "saved") throw new Error(saved.status);
      const word = saved.word;
      expect((await app.request(`/api/words/${word.id}`, { headers: auth })).status).toBe(404);
      expect((await post(app, auth, `/api/words/${word.id}/delete`)).status).toBe(404);
      expect((await app.request(`/api/audio?word=${word.id}&accent=uk`, { headers: auth })).status).toBe(404);
      expect((await post(app, auth, "/api/settings", { room: other.id })).status).toBe(400);
    });

    it("changes settings one at a time, with the bot's rules", async () => {
      const { h, app, auth } = await setup();
      const { settings } = await (await app.request("/api/settings", { headers: auth })).json();
      expect(settings).toMatchObject({ rooms: [{ name: "R", current: true }], reminderHour: 20, notifyDue: true, drill: true });
      expect(settings.modes.map((m: { key: string }) => m.key)).toContain("cloze");
      await post(app, auth, "/api/settings", { reminderHour: 9 });
      await post(app, auth, "/api/settings", { cardPart: "mnemonic", on: false });
      await post(app, auth, "/api/settings", { weeklyReport: false });
      expect(await getUser(h.db, 1)).toMatchObject({ reminderTime: "09:00", cardHidden: "mnemonic", weeklyReport: false });
      for (const key of ["ru_en", "cloze", "sentence", "listen", "collocation"]) await post(app, auth, "/api/settings", { mode: key, on: false });
      const last = await post(app, auth, "/api/settings", { mode: "en_ru", on: false });
      expect(await last.json()).toEqual({ ok: false, error: "Хотя бы один режим должен остаться включённым" });
    });
  });
});
