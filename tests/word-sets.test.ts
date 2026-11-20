import { describe, expect, it } from "vitest";
import { cards, rooms, words } from "../src/db/schema";
import { createRoom, ensurePersonalRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { decide, listSets, nextSetItems, replaceSet, setSetTarget, setTarget, setTargetChoices, starterSet, undoDecision } from "../src/services/word-sets";
import { botHarness } from "./bot-harness";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";

const TOKEN = "123:test-token";
import { DAY, T0, at, makeUser } from "./helpers";

const item = (term: string) => ({ term, translation: term + "-ru", explanation: "", example: "", transcriptionUk: "", transcriptionUs: "", usefulness: 3, usefulnessNote: "" });

async function setup() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  // Учит с друзьями в общей комнате, где уже есть «bank».
  const shared = await createRoom(h.db, { name: "Друзья", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: shared.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  await replaceSet(h.db, { slug: "b1", title: "B1", kind: "level", description: "", position: 1 }, [item("bank"), item("river"), item("tree"), item("river")], T0);
  return { h, user, shared };
}

describe("📦 word sets", () => {
  it("skips duplicates and words already being learned, counts them as done", async () => {
    const { h, user } = await setup();
    const [summary] = await listSets(h.db, user.id);
    expect(summary).toMatchObject({ total: 3, done: 1 });
    expect((await nextSetItems(h.db, user.id, summary.set.id)).map((i) => i.term)).toEqual(["river", "tree"]);
  });

  it("«учу» goes to the room the person chose, not blindly to the personal one; «знаю» just counts; both undo", async () => {
    const { h, user, shared } = await setup();
    const [river, tree] = await nextSetItems(h.db, user.id, (await listSets(h.db, user.id))[0].set.id);
    // Человек выбрал общую комнату — туда и пойдут слова, иначе они не попадут в босса этой комнаты.
    expect(await setSetTarget(h.db, user, shared.id)).toEqual({ ok: true });
    const chosen = await updateUser(h.db, user.id, { setTargetRoomId: shared.id });

    expect(await decide(h.db, { user: chosen, itemId: river.id, decision: "learn", now: T0 })).toBe(true);
    expect(await decide(h.db, { user: chosen, itemId: river.id, decision: "learn", now: T0 })).toBe(false);
    await decide(h.db, { user: chosen, itemId: tree.id, decision: "know", now: T0 });

    const added = (await h.db.select().from(words)).find((w) => w.term === "river")!;
    expect(added.roomId).toBe(shared.id);
    expect((await listSets(h.db, user.id))[0]).toMatchObject({ total: 3, done: 3 });

    await undoDecision(h.db, { userId: user.id, itemId: river.id });
    expect((await h.db.select().from(words)).map((w) => w.term)).toEqual(["bank"]);
    expect((await listSets(h.db, user.id))[0].done).toBe(2);
  });

  it("the app lists sets with progress, deals the next words and takes decisions", async () => {
    const { h } = await setup();
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}`, "content-type": "application/json" };
    const body = await (await app.request("/api/sets", { headers })).json();
    expect(body.sets).toMatchObject([{ title: "B1", total: 3, done: 1 }]);
    const sets = body.sets;
    const { items } = await (await app.request(`/api/sets/${sets[0].id}`, { headers })).json();
    expect(items.map((i: { term: string }) => i.term)).toEqual(["river", "tree"]);
    const post = (body: object) => app.request("/api/sets/decide", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ itemId: items[0].id, decision: "learn" })).status).toBe(200);
    expect((await post({ itemId: items[0].id, decision: "learn" })).status).toBe(409);
    expect((await post({ itemId: items[0].id, undo: true })).status).toBe(200);
    expect((await app.request(`/api/audio?item=${items[1].id}&accent=uk`, { headers })).status).toBe(200);
  });
});

describe("📦 первый набор новичка", () => {
  /** Наборы рядом, как в жизни: A1 и B1 лежат в одной комнате. */
  async function newcomer() {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    await replaceSet(h.db, { slug: "a1", title: "A1 · Начальный", kind: "level", description: "", position: 0 }, [item("cat"), item("dog"), item("sun")], T0);
    await replaceSet(h.db, { slug: "b1", title: "B1", kind: "level", description: "", position: 2 }, [item("bank")], T0);
    return { h, user };
  }

  const headersFor = () => ({ authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}` });

  it("starterSet отдаёт A1, а не другой уровень с меньшим порядком", async () => {
    const { h } = await newcomer();
    const starter = await starterSet(h.db);
    expect(starter?.set.slug).toBe("a1");
    expect(starter).toMatchObject({ total: 3, done: 0 });
  });

  it("без набора A1 честно ничего не предлагает, а не падает", async () => {
    const h = botHarness();
    // Наборы есть, но A1 среди них нет: предлагать новичку B1 нельзя — это не «начать».
    await replaceSet(h.db, { slug: "b1", title: "B1", kind: "level", description: "", position: 2 }, [item("bank")], T0);
    expect(await starterSet(h.db)).toBeUndefined();
  });

  it("/api/me новичку отдаёт ноль слов и набор A1 для старта", async () => {
    const { h } = await newcomer();
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const me = await (await app.request("/api/me", { headers: headersFor() })).json();

    expect(me.total).toBe(0);
    expect(me.starterSet).toMatchObject({ title: "A1 · Начальный", total: 3 });
  });

  it("у человека со словами набора нет: ему есть что учить, и «жди» — правда", async () => {
    const { h, user } = await newcomer();
    const room = await createRoom(h.db, { name: "Друзья", createdBy: user.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "own", translation: "своё", explanation: "", example: "" }, now: T0 });

    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const me = await (await app.request("/api/me", { headers: headersFor() })).json();
    // Именно по этому нулю `/learn` и отличает «всё повторил» от «нечего учить».
    expect(me.total).toBe(1);
    expect(me.starterSet).toBeUndefined();
  });
});

describe("📦 новичок в /learn", () => {
  /** То, что бот отправил человеку: тексты всех исходящих сообщений. */
  const texts = (h: ReturnType<typeof botHarness>) =>
    h.calls.flatMap((c) => ("text" in c.payload && typeof c.payload.text === "string" ? [c.payload.text] : []));

  it("пустой /learn ведёт в наборы, а не обещает, что слова появятся сами", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await replaceSet(h.db, { slug: "a1", title: "A1 · Начальный", kind: "level", description: "", position: 0 }, [item("cat"), item("dog")], T0);

    await h.bot.handleUpdate(h.message(100, "/learn"));
    const text = texts(h).at(-1)!;
    expect(text).toContain("/sets");
    expect(text).not.toContain("появятся сами");
  });

  it("у человека со словами /learn после очереди по-прежнему говорит «появятся сами»", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    const personal = await ensurePersonalRoom(h.db, user.id, T0);
    await saveWord(h.db, { roomId: personal.id, addedBy: user.id, draft: { term: "own", translation: "своё", explanation: "", example: "" }, now: T0 });
    // Слово уже отвечено и ждёт следующего срока: очередь пуста, но словарь не пуст — вот эта разница и важна.
    await h.db.update(cards).set({ state: 2, stability: 5, due: at(DAY) });
    await h.bot.handleUpdate(h.message(100, "/learn"));

    const text = texts(h).at(-1)!;
    expect(text).not.toContain("/sets");
    expect(text).toMatch(/нечего повторять|Следующее повторение/);
  });
});

describe("📦 куда «учу» кладёт слово (setTarget)", () => {
  it("без выбора берёт текущую комнату, чтобы слова попадали в босса этой комнаты", async () => {
    const { h, user, shared } = await setup();
    const inShared = await updateUser(h.db, user.id, { currentRoomId: shared.id });
    const target = await setTarget(h.db, inShared, "en", T0);
    expect(target).toMatchObject({ roomId: shared.id, roomName: "Друзья", personal: false });
  });

  it("выбор человека главнее текущей комнаты", async () => {
    const { h, user, shared } = await setup();
    const personal = await ensurePersonalRoom(h.db, user.id, T0);
    // Смотрит клуб, но складывать слова попросил в личный словарь.
    const chosen = await updateUser(h.db, user.id, { currentRoomId: shared.id, setTargetRoomId: personal.id });
    const target = await setTarget(h.db, chosen, "en", T0);
    expect(target).toMatchObject({ roomId: personal.id, personal: true });
  });

  it("выбор сбрасывается, если комнату покинули: остаётся текущая, а не мёртвый id", async () => {
    const { h, user, shared } = await setup();
    const personal = await ensurePersonalRoom(h.db, user.id, T0);
    const stale = await updateUser(h.db, user.id, { currentRoomId: shared.id, setTargetRoomId: 999_999 });
    const target = await setTarget(h.db, stale, "en", T0);
    expect(target.roomId).toBe(shared.id);
    expect(target.roomId).not.toBe(personal.id);
  });

  it("без комнат вообще заводит личный словарь, а не падает", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    const target = await setTarget(h.db, user, "en", T0);
    expect(target.personal).toBe(true);
    const [room] = (await h.db.select().from(rooms)).filter((r) => r.id === target.roomId);
    expect(room?.personalOf).toBe(user.id);
  });

  it("в чужую комнату слова не положить, даже зная её id", async () => {
    const { h, user } = await setup();
    const stranger = await makeUser(h.db, 200);
    const strangerRoom = await createRoom(h.db, { name: "Чужая", createdBy: stranger.id, now: T0 });
    expect(await setSetTarget(h.db, user, strangerRoom.id)).toMatchObject({ ok: false, error: "Ты не в этой комнате" });
  });

  it("в комнату другого языка слова не положить: там другой словарь и другие наборы", async () => {
    const { h, user } = await setup();
    const korean = await createRoom(h.db, { name: "Korean", createdBy: user.id, now: T0, language: "ko" });
    expect(await setSetTarget(h.db, user, korean.id)).toMatchObject({ ok: false });
  });

  it("в списке выбора личный словарь идёт последним", async () => {
    const { h, user, shared } = await setup();
    await ensurePersonalRoom(h.db, user.id, T0);
    const inShared = await updateUser(h.db, user.id, { currentRoomId: shared.id });
    const choices = await setTargetChoices(h.db, inShared, "en");
    expect(choices.length).toBeGreaterThan(1);
    expect(choices.at(-1)?.personal).toBe(true);
  });
});

describe("📦 /api/sets/target", () => {
  const headersFor = (token: string) => ({ authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, token, new Date())}`, "content-type": "application/json" });

  it("отдаёт комнаты и текущий выбор, а смена меняет, куда пойдут слова", async () => {
    const { h, user, shared } = await setup();
    await ensurePersonalRoom(h.db, user.id, T0);
    await updateUser(h.db, user.id, { currentRoomId: shared.id });
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const headers = headersFor(TOKEN);

    const before = await (await app.request("/api/sets/target", { headers })).json();
    expect(before.target.roomId).toBe(shared.id);
    expect(before.rooms.map((r: { roomName: string }) => r.roomName)).toContain("Друзья");

    const personal = before.rooms.find((r: { personal: boolean }) => r.personal);
    const after = await (await app.request("/api/sets/target", { method: "POST", headers, body: JSON.stringify({ roomId: personal.roomId }) })).json();
    expect(after.target).toMatchObject({ roomId: personal.roomId, personal: true });

    // Решение после смены кладёт слово в выбранный личный словарь.
    const [summary] = await listSets(h.db, user.id);
    const [river] = await nextSetItems(h.db, user.id, summary.set.id);
    const fresh = await updateUser(h.db, user.id, { setTargetRoomId: personal.roomId });
    expect(await decide(h.db, { user: fresh, itemId: river.id, decision: "learn", now: T0 })).toBe(true);
    const added = (await h.db.select().from(words)).find((w) => w.term === "river")!;
    expect(added.roomId).toBe(personal.roomId);
  });

  it("чужой id комнаты отвергается текстом для человека", async () => {
    const { h } = await setup();
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const r = await app.request("/api/sets/target", { method: "POST", headers: headersFor(TOKEN), body: JSON.stringify({ roomId: 999_999 }) });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBeTruthy();
  });
});
