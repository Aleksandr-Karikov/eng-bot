import { describe, expect, it } from "vitest";
import { bossFeed, bossOf, bossPace, bossPhase } from "../src/services/boss";
import { setWeeklyGoal } from "../src/services/goals";
import { createRoom, getRoom, joinRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { reviewLogs } from "../src/db/schema";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";
import { botHarness, buttonData } from "./bot-harness";
import { at, DAY, HOUR, makeUser, T0 } from "./helpers";
import { getUserByTelegramId, updateUser } from "../src/services/users";

// Новосибирск = UTC+7, неделя цели начинается в воскресенье 20:00.
const nsk = (iso: string) => new Date(`${iso}+07:00`);
const TOKEN = "123:test-token";

/** Комната на двоих с одним словом: у каждого по карточке. */
async function setup() {
  const h = botHarness();
  const alice = await makeUser(h.db, 100, "Alice");
  const bob = await makeUser(h.db, 200, "Bob");
  const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: nsk("2026-10-01T10:00") });
  await joinRoom(h.db, { roomId: room.id, userId: bob.id, now: nsk("2026-10-01T10:00"), makeCurrent: true });
  const saved = await saveWord(h.db, {
    roomId: room.id,
    addedBy: alice.id,
    draft: { term: "bank", translation: "берег", explanation: "", example: "" },
    now: nsk("2026-10-01T10:00"),
  });
  if (saved.status !== "saved") throw new Error("not saved");
  return { h, alice, bob, room };
}

describe("🐉 boss of the week", () => {
  it("reuses the room goal: HP is what is left of it, damage is what is done", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 10);
    // Цель читается из комнаты, поэтому после неё нужен свежий объект — как в обработчике /boss.
    const fresh = (await getRoom(h.db, room.id))!;
    for (let i = 0; i < 4; i++) {
      await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: nsk("2026-10-19T10:00") });
    }
    const boss = await bossOf(h.db, fresh, nsk("2026-10-19T12:00"));
    expect(boss.target).toBe(10);
    // «Помню» весит 2 HP, поэтому 4 ответа — это 8 урона из 10.
    expect(boss.done).toBe(8);
    expect(boss.hp).toBe(2);
    expect(boss.damage).toBeCloseTo(0.8);
  });

  it("phases go fresh → angry → furious → dead, and dead wins over everything", () => {
    expect(bossPhase(0, 0, 100)).toBe("fresh");
    expect(bossPhase(0.24, 24, 100)).toBe("fresh");
    expect(bossPhase(0.25, 25, 100)).toBe("angry");
    expect(bossPhase(0.66, 66, 100)).toBe("furious");
    expect(bossPhase(1, 100, 100)).toBe("dead");
    // Перебор сверх цели — всё равно «повержен», а не «в ярости».
    expect(bossPhase(1.4, 140, 100)).toBe("dead");
  });

  it("pace compares against what should be done by now, not against the total", () => {
    // Середина недели, цель 100: в темпе — около 50, с допуском 10.
    expect(bossPace(50, 100, 0.5)).toBe("on-time");
    expect(bossPace(70, 100, 0.5)).toBe("ahead");
    expect(bossPace(20, 100, 0.5)).toBe("behind");
    // Первый день недели: ожидалось 5, сделано 20 — это опережение, а не «отставание».
    expect(bossPace(20, 100, 0.05)).toBe("ahead");
  });

  it("the feed glues one person's answers into hits and counts the room's damage", async () => {
    const { h, alice, bob, room } = await setup();
    // Alice: 3 ответа подряд — один удар на 3.
    for (const [i, iso] of ["2026-10-19T10:00", "2026-10-19T10:00:20", "2026-10-19T10:00:40"].entries()) {
      await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: nsk(iso) });
      void i;
    }
    // Bob: 2 ответа, но с разрывом в 5 минут — два отдельных удара.
    await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "good", reviewedAt: nsk("2026-10-19T11:00") });
    await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "again", reviewedAt: nsk("2026-10-19T11:05") });

    const feed = await bossFeed(h.db, room, nsk("2026-10-19T12:00"));
    expect(feed.total).toBe(5);
    expect(feed.byUser).toEqual([
      { name: "Alice", damage: 3 },
      { name: "Bob", damage: 2 },
    ]);
    // Свежие сверху; «Забыл» тоже урон — босса бьют любым ответом.
    expect(feed.hits.map((hit) => [hit.name, hit.damage])).toEqual([
      ["Bob", 1],
      ["Bob", 1],
      ["Alice", 3],
    ]);
  });

  it("an empty week has no hits and no damage", async () => {
    const { h, room } = await setup();
    const feed = await bossFeed(h.db, room, nsk("2026-10-19T12:00"));
    expect(feed.hits).toEqual([]);
    expect(feed.byUser).toEqual([]);
    expect(feed.total).toBe(0);
  });

  it("counts days left to the end of the week", async () => {
    const { h, room } = await setup();
    // Вторник 12:00, неделя кончается в воскресенье 20:00 — 5 полных дней.
    const boss = await bossOf(h.db, room, nsk("2026-10-20T12:00"));
    expect(boss.daysLeft).toBe(5);
    // Воскресенье 19:00 — добивать сегодня.
    expect((await bossOf(h.db, room, nsk("2026-10-25T19:00"))).daysLeft).toBe(0);
  });
});

describe("🐉 /boss in the bot", () => {
  it("shows HP, pace and who hit, and offers the hit feed", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 10);
    // Комната должна быть текущей у того, кто спрашивает: /boss берёт её из currentRoomId.
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    // Дата — в ту же неделю, что «сейчас» у бота (T0 = 15 октября, четверг).
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });

    await h.bot.handleUpdate(h.message(100, "/boss"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    // Один ответ «Помню» — 2 HP: остаток 8 из 10.
    expect(text).toContain("HP: 8 из 10");
    expect(text).toContain("Удары: User100 1");
    expect(buttonData(h.calls, "⚔️")).toBe("bh");
  });

  it("complains about no room instead of guessing one", async () => {
    const h = botHarness();
    await makeUser(h.db, 300, "Carol");
    // Middleware создаёт личный словарь сам, поэтому «нет комнаты» проверяем в группе без /link.
    await h.bot.handleUpdate(h.groupMessage(300, -555, "/boss"));
    expect(String(h.calls.at(-1)?.payload.text)).toContain("/link");
  });

  it("toggles the mode from settings and says so", async () => {
    const { h, alice } = await setup();
    await h.bot.handleUpdate(h.callback(alice.telegramId, "bm"));
    // Тост переключателя — ответ на нажатие, а не сообщение.
    expect(h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)?.payload.text).toBe("Босс выключен");
    expect((await getUserByTelegramId(h.db, alice.telegramId))?.modeBoss).toBe(false);
  });

  it("the hit feed names people and their damage", async () => {
    const { h, alice, bob, room } = await setup();
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "good", reviewedAt: at(2 * HOUR) });
    await h.bot.handleUpdate(h.callback(alice.telegramId, "bh"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    // Alice пришла через middleware (имя из Telegram — User100), Bob создан прямо в базе как «Bob».
    expect(text).toContain("User100");
    expect(text).toContain("Bob");
    expect(text).toContain("удар");
  });
});

/** Ответ /api/boss так, как его увидит вкладка. */
async function bossTab() {
    const h = botHarness();
    const alice = await makeUser(h.db, 100, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await setWeeklyGoal(h.db, room.id, 10);
    const saved = await saveWord(h.db, { roomId: room.id, addedBy: alice.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
    if (saved.status !== "saved") throw new Error("fixture");
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Alice" } }, TOKEN, new Date())}` };
    return { h, alice, room, app, headers };
}

describe("🐉 boss tab in the Mini App", () => {
  it("returns HP, phase and the hit feed", async () => {
    const { h, alice, app, headers } = await bossTab();
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    const body = await (await app.request("/api/boss", { headers })).json();
    expect(body.enabled).toBe(true);
    expect(body.boss).toMatchObject({ room: "R", hp: 8, target: 10, done: 2, phase: "fresh" });
    expect(body.hits[0]).toMatchObject({ name: "Alice", damage: 1 });
  });

  it("reports the mode as off so the tab can hide itself", async () => {
    const { h, alice, app, headers } = await bossTab();
    await updateUser(h.db, alice.id, { modeBoss: false });
    expect((await (await app.request("/api/boss", { headers })).json()).enabled).toBe(false);
    expect((await (await app.request("/api/me", { headers })).json()).boss).toBe(false);
  });
});

describe("🐉 boss line under «Готово»", () => {
  it("is added to the end-of-session screen when the mode is on", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 10);
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    // Всё повторено: карточка не «созреет» до T0, поэтому очередь пуста и приходит экран «Готово».
    await h.db.update((await import("../src/db/schema")).cards).set({ due: at(DAY) }).where((await import("drizzle-orm")).eq((await import("../src/db/schema")).cards.id, 1));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    expect(text).toContain("🐉 Босс недели");
    expect(text).toContain("осталось 8 HP");
  });

  it("stays away when the mode is off", async () => {
    const { h, alice, room } = await setup();
    await updateUser(h.db, alice.id, { currentRoomId: room.id, modeBoss: false });
    const schema = await import("../src/db/schema");
    const drizzle = await import("drizzle-orm");
    await h.db.update(schema.cards).set({ due: at(DAY) }).where(drizzle.eq(schema.cards.id, 1));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    expect(text).not.toContain("🐉 Босс");
  });
});

describe("🐉 BOSS_ENABLED — рубильник всего режима", () => {
  it("is on unless explicitly 0, so an absent line never means 'no boss'", async () => {
    const { loadConfig } = await import("../src/config");
    const base = { BOT_TOKEN: "1:x" };
    expect(loadConfig(base).bossEnabled).toBe(true);
    expect(loadConfig({ ...base, BOSS_ENABLED: "1" }).bossEnabled).toBe(true);
    expect(loadConfig({ ...base, BOSS_ENABLED: "0" }).bossEnabled).toBe(false);
    // Опечатка не должна трактоваться как выключение: только точный 0.
    expect(loadConfig({ ...base, BOSS_ENABLED: "no" }).bossEnabled).toBe(true);
  });

  it("needs both the global switch and the personal mode", async () => {
    const { bossEnabled } = await import("../src/services/boss");
    expect(bossEnabled({ modeBoss: true }, undefined)).toBe(true);
    expect(bossEnabled({ modeBoss: true }, true)).toBe(true);
    expect(bossEnabled({ modeBoss: false }, true)).toBe(false);
    // Рубильник сильнее личной настройки, но личную не сбрасывает.
    expect(bossEnabled({ modeBoss: true }, false)).toBe(false);
  });

  it("hides /boss behind the switch and says how to turn it back on", async () => {
    const h = botHarness({});
    h.deps.bossEnabled = false;
    await makeUser(h.db, 400, "Dan");
    await h.bot.handleUpdate(h.message(400, "/boss"));
    const text = String(h.calls.at(-1)?.payload.text);
    expect(text).toContain("BOSS_ENABLED=1");
  });

  it("keeps the personal setting intact when the switch goes off and back on", async () => {
    const { h, alice, room } = await setup();
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    // Человек сам выключил босса.
    await updateUser(h.db, alice.id, { modeBoss: false });
    // Админ выключил и снова включил рубильник.
    h.deps.bossEnabled = false;
    h.deps.bossEnabled = true;
    // Его выбор не изменился: за него ничего не переключали.
    expect((await getUserByTelegramId(h.db, alice.telegramId))?.modeBoss).toBe(false);
  });

  it("drops the Done line while the switch is off", async () => {
    const { h, alice, room } = await setup();
    h.deps.bossEnabled = false;
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    const schema = await import("../src/db/schema");
    const drizzle = await import("drizzle-orm");
    await h.db.update(schema.cards).set({ due: at(DAY) }).where(drizzle.eq(schema.cards.id, 1));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(String(h.calls.at(-1)?.payload.text)).not.toContain("🐉 Босс");
  });

  it("tells the Mini App to hide the tab when the switch is off", async () => {
    const { h, app, headers } = await bossTab();
    h.deps.bossEnabled = false;
    const me = await (await app.request("/api/me", { headers })).json();
    expect(me.boss).toBe(false);
    const body = await (await app.request("/api/boss", { headers })).json();
    expect(body.enabled).toBe(false);
    expect(body.boss).toBeUndefined();
  });
});

describe("⚖️ weighted damage and upgrades", () => {
  it("weighs answers: easy 3, good and hard 2, again 1, and doubles the hard exercises", async () => {
    const { answerWeight } = await import("../src/services/goals");
    expect(answerWeight("easy")).toBe(3);
    expect(answerWeight("good")).toBe(2);
    expect(answerWeight("hard")).toBe(2);
    // «Забыл» — не ноль: иначе выгодно врать себе «помню», чтобы босс дох.
    expect(answerWeight("again")).toBe(1);
    expect(answerWeight("good", "listen")).toBe(4);
    expect(answerWeight("again", "app_cloze")).toBe(2);
  });

  it("grows personal damage with the upgrade level, never past whole HP", async () => {
    const { answerWeight } = await import("../src/services/goals");
    expect(answerWeight("good", undefined, 0)).toBe(2);
    expect(answerWeight("good", undefined, 1)).toBe(2); // 2.2 → 2
    expect(answerWeight("good", undefined, 5)).toBe(3); // 3.0
    expect(answerWeight("easy", undefined, 10)).toBe(6); // 3 × 2.0
  });

  it("prices upgrades 100, 200, 400 and stops at the cap", async () => {
    const { upgradePrice, MAX_UPGRADE, coinState } = await import("../src/services/boss");
    expect(upgradePrice(0)).toBe(100);
    expect(upgradePrice(1)).toBe(200);
    expect(upgradePrice(2)).toBe(400);
    const now = nsk("2026-10-20T12:00");
    const user = { upgradeDamage: MAX_UPGRADE, coinsSpent: 0, coinsPeriod: null };
    expect(coinState(10_000, user, now).price).toBeNull();
    expect(coinState(50, { upgradeDamage: 0, coinsSpent: 0, coinsPeriod: null }, now)).toMatchObject({ coins: 50, level: 0, price: 100 });
  });

  it("forgets last week's coins: the period changed, so spending starts from zero", async () => {
    const { coinState, coinsPeriod } = await import("../src/services/boss");
    const now = nsk("2026-10-20T12:00");
    // Потрачено на прошлой неделе — на этой не считается.
    expect(coinState(500, { upgradeDamage: 1, coinsSpent: 300, coinsPeriod: "2020-01-05" }, now).coins).toBe(500);
    // Потрачено на этой — вычитается.
    expect(coinState(500, { upgradeDamage: 1, coinsSpent: 300, coinsPeriod: coinsPeriod(now) }, now).coins).toBe(200);
  });

  it("gives coins only for your own damage, not the room's", async () => {
    const { h, alice, bob, room } = await setup();
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await setWeeklyGoal(h.db, room.id, 100);
    // Bob бьёт много, Alice — мало.
    for (let i = 0; i < 10; i++) {
      await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "good", reviewedAt: at(i * 60_000) });
    }
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    const boss = await bossOf(h.db, room, at(HOUR), alice.id);
    // Урон комнаты — общий (22), а «мой» — только её 2 HP: на нём считаются монеты.
    expect(boss.done).toBe(22);
    expect(boss.mine).toBe(2);
  });

  it("buys an upgrade once there are enough coins, and refuses without them", async () => {
    const { h, alice, room, app, headers } = await bossTab();
    await setWeeklyGoal(h.db, room.id, 1000);
    // 50 ответов «Помню» = 100 HP = ровно цена первого уровня.
    for (let i = 0; i < 50; i++) {
      await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(i * 1000) });
    }
    const before = await (await app.request("/api/boss", { headers })).json();
    expect(before.coins).toMatchObject({ coins: 100, level: 0, price: 100 });
    const bought = await app.request("/api/boss/upgrade", { method: "POST", headers });
    expect(bought.status).toBe(200);
    expect((await bought.json()).coins).toMatchObject({ level: 1, price: 200 });
    // Второй раз без новых монет — отказ, а не второй уровень бесплатно.
    const again = await app.request("/api/boss/upgrade", { method: "POST", headers });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toContain("не хватает");
  });
});
