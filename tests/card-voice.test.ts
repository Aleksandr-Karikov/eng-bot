import { describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";
import { createRoom, joinRoom } from "../src/services/rooms";
import { autoVoice, DEFAULT_VOICE_ACCENT, toggleVoiceAccent } from "../src/services/voice";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { cards } from "../src/db/schema";
import type { Language } from "../src/lang";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const EN: Language = { accents: ["uk", "us"] } as Language;
const KO: Language = { accents: ["uk"] } as Language;

const TOKEN = "123:test-token";
const auth = { authorization: `tma ${sign({ user: { id: 100, first_name: "User100" } }, TOKEN, new Date())}` };
const post = (app: ReturnType<typeof createApp>, body: object) =>
  app.request("/api/settings", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("🗣 озвучка карточек", () => {
  it("is on by default (British) and the second tap on the chosen accent turns it off", () => {
    // DEFAULT_VOICE_ACCENT — то же, что default("uk") в схеме: у всех, кто ничего не выбирал, звук есть.
    expect(DEFAULT_VOICE_ACCENT).toBe("uk");
    expect(autoVoice({ voiceAccent: DEFAULT_VOICE_ACCENT }, EN)).toBe("uk");
    // «Выключено» — это пустая строка, и только она.
    expect(autoVoice({ voiceAccent: "" }, EN)).toBeUndefined();
    // Выбор другого варианта — переключение; тот же или «выключить» — тишина.
    expect(toggleVoiceAccent("", "us")).toBe("us");
    expect(toggleVoiceAccent("uk", "us")).toBe("us");
    expect(toggleVoiceAccent("uk", "uk")).toBe("");
    expect(toggleVoiceAccent("us", "off")).toBe("");
    // Мусор в колонке (чужой язык, опечатка) — как «выключено», а не поломка карточки.
    expect(autoVoice({ voiceAccent: "us" }, KO)).toBeUndefined();
    expect(autoVoice({ voiceAccent: "zz" }, EN)).toBeUndefined();
  });

  it("opens /settings → 🗣 with the default on, and the second tap turns it off", async () => {
    const h = botHarness();
    await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🗣 Озвучка карточек")));
    // По умолчанию включён британский — новый пользователь не должен ничего настраивать, чтобы услышать слово.
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Сейчас: <b>🇬🇧 UK</b>");
    expect(lastButtons(h.calls).map((b) => b.text)).toEqual(["✅ 🔊 🇬🇧 UK", "⬜️ 🔊 🇺🇸 US", "⬜️ 🔇 Не включать", "◀ Назад"]);

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⬜️ 🔊 🇺🇸 US")));
    expect((await getUser(h.db, 1))!.voiceAccent).toBe("us");
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Сейчас: <b>🇺🇸 US</b>");

    // Повторное нажатие на выбранный — выключить: настройка и есть переключатель.
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ 🔊 🇺🇸 US")));
    expect((await getUser(h.db, 1))!.voiceAccent).toBe("");
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Сейчас: <b>выключена</b>");
  });

});

describe("🗣 озвучка в Mini App", () => {
  async function setup() {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "", usefulness: 3 }, now: T0 });
    return { h, app: createApp({ deps: h.deps, botToken: TOKEN }) };
  }

  it("plays the default accent by itself until the person turns it off", async () => {
    const { h, app } = await setup();
    // Новый пользователь: включено по умолчанию, ничего настраивать не надо.
    expect(await (await app.request("/api/me", { headers: auth })).json()).toMatchObject({ ok: true, voice: "uk" });
    const { settings } = await (await app.request("/api/settings", { headers: auth })).json();
    expect(settings.voice).toEqual({ accent: "uk", accents: [{ key: "uk", label: "🇬🇧 UK" }, { key: "us", label: "🇺🇸 US" }] });

    await post(app, { voice: "us" });
    expect((await getUser(h.db, 1))!.voiceAccent).toBe("us");
    expect(await (await app.request("/api/me", { headers: auth })).json()).toMatchObject({ voice: "us" });

    // Тот же вариант — выключить, как второе нажатие в боте.
    const off = await (await post(app, { voice: "us" })).json();
    expect(off).toMatchObject({ ok: true, settings: { voice: { accent: null } } });
    expect(await (await app.request("/api/me", { headers: auth })).json()).toMatchObject({ voice: null });

    // «Не включать» выключает и тогда, когда вариант был другой.
    await post(app, { voice: "uk" });
    await post(app, { voice: "off" });
    expect((await getUser(h.db, 1))!.voiceAccent).toBe("");
    expect((await post(app, { voice: "hack" })).status).toBe(400);
  });
});

// 🎧 Диктант читает выбранным вариантом произношения. Раньше акцент выбирался случайно, и при
// включённом американском британский звучал «через слово»: настройка карточки не доходила до диктанта.
describe("🎧 диктант озвучивается выбранным вариантом", () => {
  /** Включает единственный режим «на слух» и отдаёт слово к повторению. */
  async function listenSetup(voiceAccent: string) {
    const accents: string[] = [];
    const h = botHarness({ speech: { synthesize: async (_t, accent) => (accents.push(accent), Buffer.from("ogg")) } });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, {
      canDm: true, modeEnRu: false, modeRuEn: false, modeCollocation: false, modeCloze: false, modeSentence: false, modeListen: true, voiceAccent,
    });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "the river bank", usefulness: 3 }, now: T0 });
    if (saved.status !== "saved") throw new Error("fixture");
    await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due: new Date(T0.getTime() - DAY) });
    return { h, accents };
  }

  it("reads American when the person chose American", async () => {
    const { h, accents } = await listenSetup("us");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await vi.waitFor(() => expect(accents.length).toBeGreaterThan(0));
    // Диктант без звука невозможен, поэтому проверяем именно акцент, а не факт отправки.
    expect(accents).toEqual(["us"]);
  });

  it("reads British when the person chose British", async () => {
    const { h, accents } = await listenSetup("uk");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await vi.waitFor(() => expect(accents.length).toBeGreaterThan(0));
    expect(accents).toEqual(["uk"]);
  });

  it("falls back to either accent only when the voice is switched off", async () => {
    // Озвучка выключена — настройки нет, но диктант всё равно должен звучать: любой вариант лучше тишины.
    const { h, accents } = await listenSetup("");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await vi.waitFor(() => expect(accents.length).toBeGreaterThan(0));
    expect(["uk", "us"]).toContain(accents[0]);
  });
});
