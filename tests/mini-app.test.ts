import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { startCaptureServer } from "../src/capture/server";
import { sign } from "@telegram-apps/init-data-node";
import { cards, reviewLogs, words } from "../src/db/schema";
import { createApp } from "../src/app/server";
import { createRoom, joinRoom } from "../src/services/rooms";
import { getUser } from "../src/services/users";
import { getWord } from "../src/services/words";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const TOKEN = "123:test-token";

const joinRoomFor = (h: ReturnType<typeof botHarness>, roomId: number, userId: number) => joinRoom(h.db, { roomId, userId, now: T0, makeCurrent: true });

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
    // ↩️ Отменить последний свайп — и ответить заново.
    const undo = () => app.request("/api/undo", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ cardId: queue[0].cardId }) });
    expect((await undo()).status).toBe(200);
    expect(await h.db.select().from(reviewLogs)).toEqual([]);
    expect((await undo()).status).toBe(409);
    expect(await (await answer({ cardId: queue[0].cardId, reps: 0, answer: "again", stage: "en_ru" })).json()).toEqual({ ok: true, result: "ok" });
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
    const server = startCaptureServer(h.deps, 0);
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

  describe("🔗 and 🧠 — questions with options in the queue", () => {
    const quiz = { question: "We need to ___ a decision.", options: ["do", "make"], correct: 1, explanation: "make a decision" };

    it("a seen word with a ready quiz can come as «сочетания», with the right answer filled in", async () => {
      const h = botHarness({ random: () => 0.99 });
      const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
      const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
      const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "decision", translation: "решение", explanation: "", example: "", usefulness: 3 }, now: T0 });
      if (saved.status !== "saved") throw new Error("dup");
      await h.db.update(words).set({ collocations: JSON.stringify({ items: [{ phrase: "make a decision", translation: "принять решение" }], quiz }) });
      await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due: new Date(T0.getTime() - 86_400_000) });
      const app = createApp({ deps: h.deps, botToken: TOKEN });
      const auth = { authorization: `tma ${sign({ user: { id: 100, first_name: "User100" } }, TOKEN, new Date())}` };
      const { cards: queue } = await (await app.request("/api/queue", { headers: auth })).json();
      expect(queue[0]).toMatchObject({ kind: "card", stage: "collocation", quiz: { options: ["do", "make"], correct: 1, filled: { before: "We need to ", answer: "make", after: " a decision." } } });
      expect(queue[0].quiz.items).toEqual([{ phrase: "make a decision", translation: "принять решение" }]);
    });

    it("mixes a ready mistakes question in after every 5 cards and counts the answer to the topic", async () => {
      const { h, app, auth } = await setup();
      const room = (await h.db.select().from(words))[0].roomId;
      for (const term of ["a1", "a2", "a3", "a4", "a5"]) await saveWord(h.db, { roomId: room, addedBy: 1, draft: { term, translation: term, explanation: "", example: "" }, now: T0 });
      h.deps.drills.set(1, { questions: [{ ...quiz, category: "артикли" }], standalone: false, lastAtCount: 0, retryAfter: Date.now() + 60_000 });
      const { cards: queue } = await (await app.request("/api/queue", { headers: auth })).json();
      expect(queue.map((i: { kind: string }) => i.kind)).toEqual(["card", "card", "card", "card", "card", "drill", "card"]);
      expect(queue[5]).toMatchObject({ category: "артикли", options: ["do", "make"] });
      const res = await app.request("/api/drill", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ category: "артикли", correct: true }) });
      expect(res.status).toBe(200);
    });
  });

  describe("➕ adding a word from the app", () => {
    it("prepares a draft like /add, then saves it and tells friends", async () => {
      const h = botHarness({
        enricher: {
          enrich: async () => ({ term: "tooth", translation: "зуб", explanation: "часть рта", example: "I lost a tooth.", transcriptionUk: "/tuːθ/", transcriptionUs: "/tuθ/" }),
          extract: async () => [], extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }),
        },
      });
      const me = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
      const friend = await updateUser(h.db, (await makeUser(h.db, 200, "Артём")).id, { canDm: true });
      const room = await createRoom(h.db, { name: "R", createdBy: me.id, now: T0 });
      await joinRoomFor(h, room.id, friend.id);
      const app = createApp({ deps: h.deps, botToken: TOKEN });
      const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}`, "content-type": "application/json" };
      const post = (path: string, body: object) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

      const { draft } = await (await post("/api/words/prepare", { text: "зуб" })).json();
      expect(draft).toMatchObject({ term: "tooth", translation: "зуб", example: "I lost a tooth." });
      expect((await post("/api/words", { ...draft, translation: "зуб (во рту)" })).status).toBe(200);
      const [saved] = await h.db.select().from(words);
      expect(saved).toMatchObject({ term: "tooth", translation: "зуб (во рту)", addedBy: me.id });
      await new Promise((r) => setTimeout(r, 20));
      expect(h.calls.some((c) => c.method === "sendMessage" && c.payload.chat_id === 200 && String(c.payload.text).includes("tooth"))).toBe(true);
      // Второй раз — уже есть.
      expect((await post("/api/words/prepare", { text: "tooth" })).status).toBe(409);
    });
  });
});
