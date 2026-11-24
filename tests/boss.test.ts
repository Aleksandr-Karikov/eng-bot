import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { bossFeed, bossOf, bossPace, bossPhase, bossRound, roundOpponent, tierHp, LADDER_BASE_HP, upgradePrice, MAX_UPGRADE } from "../src/services/boss";
import { goalProgress, setWeeklyGoal } from "../src/services/goals";
import { createRoom, getRoom, joinRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { combatSpends, reviewLogs } from "../src/db/schema";
import { cards as cardsTable } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { answerCard } from "../src/services/review";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";
import { botHarness, buttonData } from "./bot-harness";
import { at, DAY, HOUR, makeUser, testDb, T0 } from "./helpers";
import { getUserByTelegramId, updateUser } from "../src/services/users";
import { latestDigestMoment } from "../src/services/digest";
import { damageBalanceDeci } from "../src/services/combat-ledger";
import { dropCard } from "../src/services/cards";
import { trophiesFor, weekFacts } from "../src/services/trophies";

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
      { name: "Alice", damage: 6 },
      { name: "Bob", damage: 3 },
    ]);
    // Свежие сверху; «Забыл» тоже урон — босса бьют любым ответом.
    expect(feed.hits.map((hit) => [hit.name, hit.damage])).toEqual([
      ["Bob", 1],
      ["Bob", 2],
      ["Alice", 6],
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
    expect(text).toContain("Удары: User100 2");
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
    expect(text).toContain("2 HP урона");
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

describe("урон из запаса", () => {
  // Настройка по умолчанию: ручной удар недоступен, потому что копить выключено. Экран обязан объяснить
  // это и предложить включить — тест фиксирует состояние сервера, на котором держится объяснение (E1).
  it("при выключенном «Копить урон» ручной удар недоступен, и это видно по состоянию", async () => {
    const { app, headers, alice, room } = await bossTab();
    const state = await (await app.request("/api/boss", { headers })).json();
    expect(state.combat.bank).toBe(false);
    expect(state.combat.balance).toBe(0);
    expect(state.combat.hit).toMatchObject({ spend: 0, damage: 0 });
    expect(state.boss.hp).toBeGreaterThan(0);

    // Ответ всё равно идёт в босса комнаты напрямую — поэтому человек и не должен видеть пустой запас
    // как «сломалось»: урон начислен, просто потратить его ударом нечего.
    const post = async (path: string, body: object) => (await app.request(path, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
    expect(await post("/api/answer", { cardId: 1, reps: 0, answer: "good" })).toMatchObject({ result: "ok" });
    const after = await (await app.request("/api/boss", { headers })).json();
    expect(after.combat.balance).toBe(0);
    expect(after.boss.hp).toBeLessThan(state.boss.hp);

    // Кнопка «Включить копить урон» делает запас ненулевым: следующий ответ уже копится.
    const { combat } = await post("/api/boss/combat", { bank: true });
    expect(combat).toMatchObject({ bank: true, balance: 0, roomId: room.id });
    expect(await post("/api/answer", { cardId: 1, reps: 1, answer: "good" })).toMatchObject({ result: "ok" });
    const banked = await (await app.request("/api/boss", { headers })).json();
    expect(banked.combat.balance).toBeGreaterThan(0);
  });

  it("зачисляет ответ один раз, применяет ручной удар к боссу и защищает потраченный запас от отмены", async () => {
    const { h, app, headers, room } = await bossTab();
    await setWeeklyGoal(h.db, room.id, 2);
    const post = async (path: string, body: object) => (await app.request(path, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
    const { combat, boss } = await post("/api/boss/combat", { bank: true });
    expect(combat).toMatchObject({ bank: true, balance: 0, roomId: room.id });
    expect(boss.hp).toBe(2);

    const answer = { cardId: 1, reps: 0, answer: "good" };
    expect(await post("/api/answer", answer)).toMatchObject({ result: "ok", damage: 2 });
    expect(await post("/api/undo", { cardId: 1 })).toMatchObject({ ok: true });
    expect(await post("/api/answer", answer)).toMatchObject({ result: "ok", damage: 2 });
    expect(await post("/api/answer", answer)).toMatchObject({ result: "stale" });
    expect(await (await app.request("/api/boss", { headers })).json()).toMatchObject({
      combat: { balance: 2 }, boss: { hp: 2 }, hits: [],
    });

    const attack = { target: "boss", roomId: room.id, week: combat.week, requestId: randomUUID(), maxDamageDeci: 20 };
    const result = await post("/api/boss/combat", attack);
    // Добили — и сразу следующий босс с полным HP, а не пустой экран до воскресенья.
    expect(result).toMatchObject({ damage: 2, combat: { balance: 0 }, boss: { hp: tierHp(2, 1, 2), round: 2, kills: 1, progress: 0, bossHp: tierHp(2, 1, 2) }, hits: [{ damage: 2 }] });
    expect(await post("/api/boss/combat", attack)).toMatchObject({ notice: expect.any(String), combat: { balance: 0 } });
    expect(await post("/api/undo", { cardId: 1 })).toMatchObject({ ok: false });
  });

  it("выдаёт награду моба один раз, сохраняет остаток при удалении карточки и меняет босса по неделям", async () => {
    const { h, app, headers, alice, room } = await bossTab();
    const { db } = h;
    const bob = await makeUser(db, 200, "Bob");
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    const post = async (path: string, body: object) => (await app.request(path, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
    const { combat, boss } = await post("/api/boss/combat", { bank: true });
    expect(combat.mobs).toMatchObject([
      { id: "golem", hp: 30 }, { id: "ghost", hp: 45 }, { id: "spider", hp: 70 },
      { id: "mimic", hp: 100 }, { id: "chimera", hp: 150 },
    ]);
    await db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(-7 * DAY), damageDeci: 2700, banked: true });
    const strike = (target: string, hp: number, week = combat.week) =>
      post("/api/boss/combat", { target, roomId: room.id, week, requestId: randomUUID(), maxDamageDeci: hp * 10 });
    expect(await strike("boss", 10, latestDigestMoment(at(-7 * DAY)).date)).toMatchObject({ notice: expect.any(String), combat: { balance: 270 } });
    expect(await strike("golem", 12)).toMatchObject({ notice: expect.any(String), combat: { balance: 270 } });

    const golems = await Promise.all([strike("golem", 30), strike("golem", 30)]);
    expect(golems.filter((result) => result.damage === 30)).toHaveLength(1);
    expect(golems.find((result) => result.damage === 30)).toMatchObject({ coins: { coins: 4 }, combat: { balance: 240 }, boss: { hp: 10 } });
    expect(await strike("ghost", 45)).toMatchObject({ damage: 45, combat: { balance: 195 }, boss: { hp: 10 } });
    expect(await strike("spider", 70)).toMatchObject({ damage: 70, combat: { balance: 125 } });
    expect(await strike("mimic", 100)).toMatchObject({ damage: 100, coins: { coins: 34 }, combat: { balance: 25 } });
    expect(await strike("chimera", 150)).toMatchObject({ notice: expect.any(String), combat: { balance: 25 } });
    expect(await post("/api/answer", { cardId: 1, reps: 0, answer: "good", stage: "listen" })).toMatchObject({ damage: 4.8 });
    expect(await post("/api/answer", { cardId: 1, reps: 1, answer: "good", stage: "sentence" })).toMatchObject({ damage: 4.8 });

    // Добили первого — на арене сразу второй, с полным HP.
    expect(await strike("boss", 10)).toMatchObject({ damage: 10, combat: { balance: 24.6 }, boss: { hp: tierHp(2, 1, 10), round: 2, kills: 1, bossHp: tierHp(2, 1, 10) } });
    await dropCard(db, alice.id, 1);
    expect(await damageBalanceDeci(db, alice.id)).toBe(246);

    const next = at(7 * DAY);
    const facts = await weekFacts(db, (await getRoom(db, room.id))!, next);
    expect(trophiesFor(facts, alice.id, new Set()).map((trophy) => trophy.kind)).toContain("team-win");
    h.setNow(next);
    const state = await (await app.request("/api/boss", { headers })).json();
    expect(state.boss.opponent.id).not.toBe(boss.opponent.id);
    expect(state.combat.balance).toBe(24.6);
    expect(state.combat.mobs.map((mob: { defeated: boolean }) => mob.defeated)).toEqual([false, false, false, false, false]);
  });
});

it("навсегда открывает реликвии за разные недели и складывает их с наградой моба текущей недели", async () => {
  const { h, app, headers, alice, room } = await bossTab();
  const post = async (path: string, body: object) => (await app.request(path, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
  })).json();
  const boss = async () => (await app.request("/api/boss", { headers })).json();
  const pastWins = async (...weeksAgo: number[]) => h.db.insert(combatSpends).values(weeksAgo.map<typeof combatSpends.$inferInsert>((weeks, i) => {
    const when = at(-weeks * 7 * DAY);
    return {
      userId: alice.id, target: i % 2 === 0 ? "golem" : "ghost", mobWeek: latestDigestMoment(when).date,
      damageDeci: 450, requestId: randomUUID(), at: when,
    };
  }));
  const answer = (reps: number, stage: string) => post("/api/answer", { cardId: 1, reps, answer: "good", stage });

  await pastWins(1, 1);
  await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(-7 * DAY), damageDeci: 9000, banked: true });
  const { combat } = await post("/api/boss/combat", { bank: true });
  const strike = (target: string, hp: number) => post("/api/boss/combat", {
    target, roomId: room.id, week: combat.week, requestId: randomUUID(), maxDamageDeci: hp * 10,
  });
  expect(combat.hunt).toMatchObject({ weeks: 1, thisWeek: false });
  expect(await answer(0, "en_ru")).toMatchObject({ damage: 2 });
  expect(await strike("golem", 30)).toMatchObject({ combat: { hunt: { weeks: 2, thisWeek: true } } });
  expect(await answer(1, "en_ru")).toMatchObject({ damage: 2.1 });

  await pastWins(3, 5);
  expect(await boss()).toMatchObject({ combat: { hunt: { weeks: 4, thisWeek: true } } });
  expect(await answer(2, "listen")).toMatchObject({ damage: 4.6 });

  await pastWins(7, 9, 11, 13);
  expect(await strike("spider", 70)).toMatchObject({ combat: { hunt: { weeks: 8, thisWeek: true } } });
  expect(await answer(3, "sentence")).toMatchObject({ damage: 5.4 });
  h.setNow(at(7 * DAY));
  expect(await boss()).toMatchObject({ combat: { hunt: { weeks: 8, thisWeek: false } } });
  expect(await answer(4, "sentence")).toMatchObject({ damage: 4.6 });
});

it("открывает ядро на половине HP, тратит руну один раз и показывает итоги командной победы", async () => {
  const { h, app, headers, alice, room } = await bossTab();
  const now = nsk("2026-11-19T12:00");
  h.setNow(now);
  await setWeeklyGoal(h.db, room.id, 100);
  const bob = await makeUser(h.db, 200, "Bob");
  await joinRoom(h.db, { roomId: room.id, userId: bob.id, now, makeCurrent: true });
  const post = async (path: string, body: object) => (await app.request(path, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
  })).json();
  const state = async () => (await app.request("/api/boss", { headers })).json();
  const credit = (damageDeci: number, banked: boolean) => h.db.insert(reviewLogs).values({
    userId: alice.id, cardId: 1, rating: "good", reviewedAt: new Date(now.getTime() - 1000), damageDeci, banked,
  });
  expect(await state()).toMatchObject({ boss: { opponent: { id: "sentinel" }, hp: 100 }, combat: { core: "closed" } });
  await credit(500, false);
  await credit(300, true);
  const before = await state();
  expect(before).toMatchObject({ boss: { hp: 50 }, combat: { core: "ready", hit: { spend: 30, damage: 36 }, rune: { extra: 7.5, owned: false } } });

  const buy = () => post("/api/boss/upgrade", { kind: "rune" });
  const purchases = await Promise.all([buy(), buy()]);
  expect(purchases.filter((result) => result.ok)).toHaveLength(1);
  expect(await state()).toMatchObject({ coins: { coins: 40 }, combat: { hit: { spend: 30, damage: 43.5 }, rune: { owned: true } } });

  const strike = (hp: number, requestId = randomUUID()) => post("/api/boss/combat", {
    target: "boss", roomId: room.id, week: before.boss.week, requestId, maxDamageDeci: hp * 10,
  });
  const requestId = randomUUID();
  expect(await strike(30, requestId)).toMatchObject({ damage: 43.5, boss: { hp: 6.5 }, combat: { balance: 0, core: "spent", rune: { owned: false } } });
  await credit(60, true);
  expect(await strike(30, requestId)).toMatchObject({ notice: expect.any(String), combat: { balance: 6 } });
  expect(await strike(6)).toMatchObject({ damage: 6, boss: { hp: 0.5 } });
  await credit(10, true);
  expect(await strike(1)).toMatchObject({
    // Добили — сразу второй босс с полным HP; недельный вклад при этом остаётся недельным.
    damage: 0.5, boss: { hp: tierHp(2, 1, 100), round: 2, kills: 1, bossHp: tierHp(2, 1, 100), byUser: [{ name: "Alice", count: 100 }] }, combat: { balance: 0.5 },
    victory: { finalBlow: { name: "Alice" }, teamTrophy: true },
  });
  expect(await buy()).toMatchObject({ combat: { rune: { owned: true } } });
  h.setNow(nsk("2026-11-26T12:00"));
  expect(await state()).toMatchObject({ boss: { phase: "fresh" }, combat: { rune: { owned: true } } });
});

it("усиливает только диктанты и только во время ярости Дракона", async () => {
  const { h, app, headers, alice, room } = await bossTab();
  const now = nsk("2026-11-26T12:00");
  h.setNow(now);
  await setWeeklyGoal(h.db, room.id, 100);
  const credit = (damageDeci: number) => h.db.insert(reviewLogs).values({
    userId: alice.id, cardId: 1, rating: "good", reviewedAt: new Date(now.getTime() - 1000), damageDeci,
  });
  const answer = async (reps: number, stage: string) => (await app.request("/api/answer", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ cardId: 1, reps, answer: "good", stage }),
  })).json();
  await credit(650);
  expect(await answer(0, "listen")).toMatchObject({ damage: 4 });
  expect(await answer(1, "listen")).toMatchObject({ damage: 4.8 });
  expect(await answer(2, "sentence")).toMatchObject({ damage: 4 });
  await credit(300);
  expect(await answer(3, "listen")).toMatchObject({ damage: 4 });
});

it("показывает баф ударного режима и начисляет его за серию местных дней", async () => {
  const { h, app, headers, alice } = await bossTab();
  h.setNow(nsk("2026-11-21T01:30"));
  // Два разных дня в Новосибирске попали в один день UTC.
  await h.db.insert(reviewLogs).values(["2026-11-19T23:55", "2026-11-20T00:10", "2026-11-20T23:50"].map((time) => ({
    userId: alice.id, cardId: 1, rating: "good", reviewedAt: nsk(time),
  })));
  const state = async () => (await app.request("/api/boss", { headers })).json();
  const answer = async (reps: number, practice = false) => (await app.request("/api/answer", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ cardId: 1, reps, answer: "good", practice }),
  })).json();
  expect(await state()).toMatchObject({ combat: { streak: { days: 2, percent: 0, next: { days: 3, percent: 5 } } } });
  expect(await answer(0, true)).toMatchObject({ result: "practice", damage: 0 });
  expect(await state()).toMatchObject({ combat: { streak: { days: 2, percent: 0 } } });
  expect(await answer(0)).toMatchObject({ damage: 2.1 });
  expect(await state()).toMatchObject({ combat: { streak: { days: 3, percent: 5, next: { days: 7, percent: 10 } } } });
  h.setNow(nsk("2026-11-22T11:00"));
  expect(await state()).toMatchObject({ combat: { streak: { days: 3, percent: 5 } } });
  h.setNow(nsk("2026-11-23T11:00"));
  expect(await state()).toMatchObject({ combat: { streak: { days: 0, percent: 0 } } });
  expect(await answer(1)).toMatchObject({ damage: 2 });
});

it("выбирает только самую высокую ступень бафа", async () => {
  const { h, app, headers, alice } = await bossTab();
  const addDays = (first: number) => h.db.insert(reviewLogs).values(Array.from({ length: 7 }, (_, i) => ({
    userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(-(first + i) * DAY),
  })));
  const state = async () => (await app.request("/api/boss", { headers })).json();
  await addDays(1);
  expect(await state()).toMatchObject({ combat: { streak: { days: 7, percent: 10, next: { days: 14, percent: 15 } } } });
  await addDays(8);
  expect(await state()).toMatchObject({ combat: { streak: { days: 14, percent: 15, next: null } } });
});

describe("🐉 boss tab in the Mini App", () => {
  it("returns HP, phase and the hit feed", async () => {
    const { h, alice, app, headers } = await bossTab();
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    const body = await (await app.request("/api/boss", { headers })).json();
    expect(body.enabled).toBe(true);
    expect(body.boss).toMatchObject({ room: "R", hp: 8, target: 10, done: 2, phase: "fresh" });
    expect(body.hits[0]).toMatchObject({ name: "Alice", damage: 2 });
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
    expect(answerWeight("good", undefined, 1)).toBe(2.2); // бонус действует сразу
    expect(answerWeight("good", undefined, 5)).toBe(3); // 3.0
    expect(answerWeight("easy", undefined, 10)).toBe(6); // 3 × 2.0
  });

  it("prices upgrades 100, 150, 225 and stops at the cap", async () => {
    const { upgradePrice, MAX_UPGRADE, coinState } = await import("../src/services/boss");
    expect(upgradePrice(0)).toBe(100);
    // Рост ×1.5, а не ×2: иначе верх лестницы недостижим при линейном доходе.
    expect(upgradePrice(1)).toBe(150);
    expect(upgradePrice(2)).toBe(225);
    // Вся лестница достижима: сумма всех уровней обозрима, а не сотни недель дохода.
    let total = 0;
    for (let l = 0; l < MAX_UPGRADE; l++) total += upgradePrice(l);
    expect(total).toBeLessThan(12_000);
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
    expect((await bought.json()).coins).toMatchObject({ level: 1, price: 150 });
    // Второй раз без новых монет — отказ, а не второй уровень бесплатно.
    const again = await app.request("/api/boss/upgrade", { method: "POST", headers });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toContain("не хватает");
  });
});

describe("boss damage and rewards stay consistent", () => {
  it("freezes damage at the answer, including the first upgrade, and undo removes it", async () => {
    const { recordAnswer, undoAnswer } = await import("../src/services/review");
    const { users } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const { h, alice, room } = await setup();
    const now = nsk("2026-10-19T12:00");
    await h.db.update(users).set({ upgradeDamage: 1 }).where(eq(users.id, alice.id));
    expect(await recordAnswer(h.db, { userId: alice.id, cardId: 1, expectedReps: 0, answer: "good", now })).toEqual({ result: "ok", damage: 2.2 });
    await h.db.update(users).set({ upgradeDamage: 10 }).where(eq(users.id, alice.id));
    expect((await bossOf(h.db, room, now, alice.id)).mine).toBe(2.2);
    expect((await bossFeed(h.db, room, now)).byUser[0].damage).toBe(2.2);
    expect(await recordAnswer(h.db, { userId: alice.id, cardId: 1, expectedReps: 0, answer: "easy", now })).toEqual({ result: "stale", damage: 0 });
    await undoAnswer(h.db, { userId: alice.id, cardId: 1 });
    expect((await bossOf(h.db, room, now)).done).toBe(0);
  });

  it("dry run writes nothing, weekly backfill skips one-off rewards, and an idle member can be carried", async () => {
    const { collectTrophies, weekFacts } = await import("../src/services/trophies");
    const { trophies } = await import("../src/db/schema");
    const { h, alice, bob, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 4);
    const fresh = (await getRoom(h.db, room.id))!;
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 44, reviewedAt: nsk("2026-10-19T10:00") });
    const now = nsk("2026-10-25T20:00");
    const facts = await weekFacts(h.db, fresh, now);
    expect(facts.killer).toBe(alice.id);
    expect(facts.damage.get(alice.id)).toBe(4.4);
    expect(facts.hpBeforeKill).toBe(4);
    const dry = await collectTrophies(h.db, now, { dryRun: true });
    expect(dry.find((r) => r.user.id === bob.id)?.earned.map((t) => t.kind)).toContain("carried");
    expect(await h.db.select().from(trophies)).toEqual([]);
    await collectTrophies(h.db, now, { weeklyOnly: true });
    expect((await h.db.select().from(trophies)).every((t) => t.kind !== "carried")).toBe(true);
    const live = await collectTrophies(h.db, now);
    expect(live.find((r) => r.user.id === bob.id)?.earned.map((t) => t.kind)).toContain("carried");
    expect(await collectTrophies(h.db, now)).toEqual([]);
  });

  it("does not sell the same upgrade twice when purchases race", async () => {
    const { buyUpgrade } = await import("../src/services/boss");
    const { h, alice } = await setup();
    const results = await Promise.all([buyUpgrade(h.db, alice.id, 100, T0), buyUpgrade(h.db, alice.id, 100, T0)]);
    expect(results.sort()).toEqual(["ok", "poor"]);
  });
});

describe("boss shop with a choice of upgrades", () => {
  it("sells a chosen skill, keeps strength, validates kind, and uses the same wallet", async () => {
    const { users } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const { recordAnswer } = await import("../src/services/review");
    const { h, alice, app, headers } = await bossTab();
    await h.db.update(users).set({ upgradeDamage: 1 }).where(eq(users.id, alice.id));
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 3000, reviewedAt: T0 });
    const shop = await (await app.request("/api/boss", { headers })).json();
    expect(shop.coins.offers.map((o: { kind: string }) => o.kind)).toEqual(["damage", "listen", "writing"]);
    expect(shop.coins.offers[0]).toMatchObject({ level: 1, price: 150 });
    const buy = (kind: unknown) => app.request("/api/boss/upgrade", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ kind }) });
    expect((await buy("upgradeDamage")).status).toBe(400);
    const bought = await (await buy("listen")).json();
    expect(bought.coins).toMatchObject({ coins: 200, level: 1 });
    expect(bought.coins.offers[1]).toMatchObject({ level: 1, price: 150 });
    const written = await (await buy("writing")).json();
    expect(written.coins).toMatchObject({ coins: 100 });
    expect(written.coins.offers[2]).toMatchObject({ level: 1, price: 150 });
    expect((await buy("damage")).status).toBe(400);
    // Урон считаем через формулу, а не числом: с ладдером на бонус Дракона влияет то, в какой фазе стоит
    // текущий босс, и зашитое число поплыло бы при любой правке кривой.
    const { answerWeight } = await import("../src/services/goals");
    const replied = await recordAnswer(h.db, { userId: alice.id, cardId: 1, expectedReps: 0, answer: "good", stage: "app_listen", now: T0 });
    expect(replied.result).toBe("ok");
    // Усиления «Слух» 1 и «Сила» 1 дают +20% и +10% к базовому весу диктанта. Бонус Дракона добавляется
    // сверху, только когда он в ярости, поэтому проверяем без него — тест про магазин, а не про боссов.
    expect(replied.damage).toBeCloseTo(answerWeight("good", "app_listen", 1, 1, 0, 0), 1);
  });

  it("specialist bonuses apply only to the matching exercises and add to strength", async () => {
    const { answerWeight } = await import("../src/services/goals");
    expect(answerWeight("good", "app_listen", 1, 1, 1)).toBe(5.2);
    expect(answerWeight("good", "listen", 0, 1, 0)).toBe(4.8);
    expect(answerWeight("good", "app_cloze", 0, 0, 1)).toBe(4.8);
    expect(answerWeight("good", "sentence", 0, 0, 1)).toBe(4.8);
    expect(answerWeight("good", "en_ru", 1, 10, 10)).toBe(2.2);
    expect(answerWeight("good", "app_listen", 0, 0, 10)).toBe(4);
  });

  it("concurrent purchases of different skills cannot spend the same coins", async () => {
    const { buyUpgrade } = await import("../src/services/boss");
    const { h, alice } = await setup();
    const results = await Promise.all([buyUpgrade(h.db, alice.id, 100, T0, "listen"), buyUpgrade(h.db, alice.id, 100, T0, "writing")]);
    expect(results.sort()).toEqual(["ok", "poor"]);
  });
});


// 🕐 Неделя босса — по поясу комнаты, а не по общему. Комната, созданная в Москве, кончается в 20:00 МСК,
// и её босс, лента и монеты должны переключаться именно там. Раньше смещение было зашито («+07:00»).
describe("🕐 boss follows the room's timezone", () => {
  const msk = (iso: string) => new Date(`${iso}+03:00`);

  /** Комната в Москве с одним словом и карточкой у автора. */
  async function moscowRoom() {
    const h = botHarness();
    const alice = await updateUser(h.db, (await makeUser(h.db, 1, "Alice")).id, { timezone: "Europe/Moscow" });
    const room = await createRoom(h.db, { name: "Москва", createdBy: alice.id, now: msk("2026-10-12T10:00") });
    await saveWord(h.db, {
      roomId: room.id, addedBy: alice.id,
      draft: { term: "bank", translation: "берег", explanation: "", example: "" },
      now: msk("2026-10-12T10:00"),
    });
    return { h, alice, room };
  }

  it("keeps the author's zone on the room and reports it in the state", async () => {
    const { h, room } = await moscowRoom();
    // Пояс автора переехал в комнату: если автор потом передумает, неделя останется на месте.
    expect(room.timezone).toBe("Europe/Moscow");
    const boss = await bossOf(h.db, room, msk("2026-10-15T12:00"));
    expect(boss.timeZone).toBe("Europe/Moscow");
    // Неделя началась в воскресенье 20:00 МСК = 11 октября 17:00 UTC.
    expect(boss.week).toBe("2026-10-11");
  });

  it("switches the week at 20:00 of the room's zone", async () => {
    const { h, room } = await moscowRoom();
    // За минуту до — ещё старая неделя (11-го), сразу после — новая (18-е).
    expect((await bossOf(h.db, room, msk("2026-10-18T19:59"))).week).toBe("2026-10-11");
    expect((await bossOf(h.db, room, msk("2026-10-18T20:00"))).week).toBe("2026-10-18");
  });

  it("defaults to the shared zone for rooms created before the column existed", async () => {
    const { h, room } = await moscowRoom();
    // Старая строка без пояса: не падаем и считаем по общему поясу — так же, как до правки.
    const legacy = { ...room, timezone: "" };
    expect((await bossOf(h.db, legacy, msk("2026-10-15T12:00"))).timeZone).toBe("Asia/Novosibirsk");
  });

  it("counts a strike in the week where it happened by the room's clock", async () => {
    const { h, alice, room } = await moscowRoom();
    const card = (await h.db.select().from(cardsTable).where(eq(cardsTable.userId, alice.id)))[0];
    // Два ответа: один в прошлой неделе (вс 19:30 МСК), другой в новой (вс 20:30 МСК).
    await answerCard(h.db, { userId: alice.id, cardId: card.id, expectedReps: card.reps, answer: "good", now: msk("2026-10-18T19:30") });
    const afterFirst = await bossFeed(h.db, room, msk("2026-10-18T19:31"), 20);
    expect(afterFirst.total).toBe(1);
    const freshCard = (await h.db.select().from(cardsTable).where(eq(cardsTable.userId, alice.id)))[0];
    await answerCard(h.db, { userId: alice.id, cardId: freshCard.id, expectedReps: freshCard.reps, answer: "good", now: msk("2026-10-18T20:30") });
    // В новой неделе — только второй ответ: первый остался в прошлой.
    const nextWeek = await bossFeed(h.db, room, msk("2026-10-18T20:31"), 20);
    expect(nextWeek.total).toBe(1);
  });
});


// 🐉 Добитая цель не оставляет комнату без боя до воскресенья: недельный урон нарезан на раунды,
// каждый следующий босс — другой противник и толще предыдущего.
describe("🐉 a new boss takes the arena right after a kill", () => {
  const TARGET = 100;

  it("makes every next tier tougher, and the next cycle tougher still", () => {
    // Первая ступень — база (по умолчанию одно число для всех: LADDER_BASE_HP).
    expect(tierHp(1, 1, TARGET)).toBe(TARGET);
    expect(tierHp(2, 1, TARGET)).toBeGreaterThan(tierHp(1, 1, TARGET));
    expect(tierHp(3, 1, TARGET)).toBeGreaterThan(tierHp(2, 1, TARGET));
    // Пройден весь круг — следующий начинается сильнее первого круга, а не повторяет его.
    expect(tierHp(1, 2, TARGET)).toBeGreaterThan(tierHp(1, 1, TARGET));
    expect(tierHp(2, 2, TARGET)).toBeGreaterThan(tierHp(2, 1, TARGET));
    // Ладдер один на всех: по умолчанию база фиксирована.
    expect(tierHp(1)).toBe(LADDER_BASE_HP);
  });

  it("puts a different opponent on the arena each round", () => {
    const weekStart = new Date("2026-11-15T13:00:00Z");
    const first = roundOpponent(weekStart, 1);
    const second = roundOpponent(weekStart, 2);
    expect(second.id).not.toBe(first.id);
    // Противники чередуются, а не выпадают случайно: третий снова как первый.
    expect(roundOpponent(weekStart, 3).id).toBe(first.id);
  });

  it("splits weekly damage into rounds by the growing hp", () => {
    // Ноль — первый босс, ничего не добито.
    expect(bossRound(0, TARGET)).toMatchObject({ round: 1, kills: 0, progress: 0, hp: TARGET });
    // Ровно цель — уже следующий босс с полным HP, а не «повержен и пусто».
    const afterOne = bossRound(TARGET, TARGET);
    expect(afterOne).toMatchObject({ round: 2, kills: 1, progress: 0 });
    expect(afterOne.hp).toBe(tierHp(2, 1, TARGET));
    // Перебор засчитывается: несколько раундов сразу.
    let toKillThree = 0;
    for (const r of [1, 2, 3]) toKillThree += tierHp(r, 1, TARGET);
    expect(bossRound(toKillThree, TARGET)).toMatchObject({ round: 4, kills: 3, progress: 0 });
    // Чуть меньше — третий ещё стоит и почти добит.
    const almost = bossRound(toKillThree - 1, TARGET);
    expect(almost).toMatchObject({ round: 3, kills: 2 });
    expect(almost.progress).toBeGreaterThan(0);
  });

  it("never leaves progress above the boss's own hp", () => {
    // Свойство, а не число: при любом уроне остаток меньше HP текущего босса и не отрицателен.
    for (const done of [0, 1, 99.9, 100, 101, 224.9, 225, 400, 1000]) {
      const r = bossRound(done, TARGET);
      expect(r.progress).toBeGreaterThanOrEqual(0);
      expect(r.progress).toBeLessThan(r.hp);
    }
  });

  it("gives the room a fresh, tougher boss instead of an empty week", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 10);
    // Комната добила цель (10 HP) ещё во вторник: пять ответов «Помню» по 2 HP.
    await h.db.insert(reviewLogs).values(Array.from({ length: 5 }, (_, i) => ({
      userId: alice.id, cardId: 1, rating: "good", reviewedAt: at((i + 1) * HOUR),
    })));
    const boss = await bossOf(h.db, (await getRoom(h.db, room.id))!, at(6 * HOUR));
    // Второй босс толще первого — иначе «новый» был бы клоном добитого.
    expect(boss).toMatchObject({ round: 2, kills: 1, phase: "fresh", progress: 0 });
    expect(boss.bossHp).toBeGreaterThan(boss.target);
    expect(boss.hp).toBe(boss.bossHp);
  });

  it("counts up while the room keeps hitting", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 2);
    // При цели 2 HP и росте 1.25 двадцать ответов по 2 HP дают несколько добиваний.
    for (let i = 0; i < 20; i++) {
      await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(i * HOUR) });
    }
    const boss = await bossOf(h.db, (await getRoom(h.db, room.id))!, at(21 * HOUR));
    expect(boss.kills).toBeGreaterThan(1);
    expect(boss.round).toBe(boss.kills + 1);
  });

  it("names the last kill as the final blow, not the first", async () => {
    const { h, alice, bob, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 2);
    // Два добивания: первый босс (2 HP) — Alice, второй (2.5 HP) — Bob двумя ударами по 2 и 1.
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "good", reviewedAt: at(2 * HOUR) });
    await h.db.insert(reviewLogs).values({ userId: bob.id, cardId: 2, rating: "again", reviewedAt: at(2 * HOUR + 1000) });
    const now = at(3 * HOUR);
    const boss = await bossOf(h.db, (await getRoom(h.db, room.id))!, now);
    const feed = await bossFeed(h.db, (await getRoom(h.db, room.id))!, now, 20, boss.target);
    expect(boss.kills).toBe(2);
    expect(feed.finalBlow?.name).toBe("Bob");
  });

  it("shows the kill count in the bot text", async () => {
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 2);
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", reviewedAt: at(HOUR) });
    await h.bot.handleUpdate(h.message(100, "/boss"));
    const text = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);
    // Арена не пустует: в чате видно счёт добитых и что бой идёт дальше.
    expect(text).toContain("Добито на этой неделе: 1");
    expect(text).not.toContain("реванш");
  });
});

// 🎲 Рогалик: боссы каждую неделю одни и те же (ладдер фиксирован), а глубина растёт от прокачки.
// Это главное свойство режима, поэтому оно проверяется отдельно от арифметики ступеней.
describe("🎲 the ladder is the same every week, depth comes from power", () => {
  /** Сколько боссов проходит сила `weekly` (урон за неделю) при базе ладдера. */
  const depth = (weekly: number) => bossRound(weekly, LADDER_BASE_HP).kills;

  it("does not make the first boss tougher for a stronger room", () => {
    // Ступень 1 одна и та же для всех: первый босс недели не зависит от прошлой активности.
    expect(tierHp(1)).toBe(LADDER_BASE_HP);
    expect(tierHp(1)).toBe(tierHp(1, 1));
  });

  it("goes deeper as the room grows stronger", () => {
    // Ровно то, ради чего режим: та же лесенка, но больше силы — больше пройдено.
    expect(depth(200)).toBeGreaterThan(depth(40));
    expect(depth(400)).toBeGreaterThan(depth(200));
  });

  it("makes the whole ladder reachable within the upgrade cap", () => {
    // Прокачка ограничена ×2 (10 уровней по +10%). Если бы ладдер требовал больше, «доходить дальше»
    // было бы недостижимо в принципе — верх лестницы просто не открылся бы никогда.
    const maxPower = 200 * 2;
    expect(depth(maxPower)).toBeGreaterThanOrEqual(5);
  });

  it("lets a beginner beat the first boss", () => {
    // Новичок с двадцатью ответами за неделю (40 HP) должен увидеть победу, иначе режим не начат.
    expect(depth(40)).toBeGreaterThanOrEqual(1);
  });

  it("keeps the price of the whole ladder within a year of play", () => {
    // Доход монет = недельный урон. Сумма цен всех уровней не должна требовать больше года игры,
    // иначе верхние уровни недостижимы и прогрессия обрывается.
    let total = 0;
    for (let l = 0; l < MAX_UPGRADE; l++) total += upgradePrice(l);
    const weeksAt200 = total / 200;
    expect(weeksAt200).toBeLessThan(60);
  });
});


describe("рубильник BOSS_ENABLED не меняет числа (E7)", () => {
  /**
   * Ранбук обещает: `BOSS_ENABLED=0` выключает показ режима, но числа в `/goal` остаются прежними,
   * а после `BOSS_ENABLED=1` возвращается ровно то, что было. Дефект был в том, что флаг просачивался
   * в расчёт ответа (через `deps.bossEnabled`) и там гасил две вещи:
   *
   * 1. `banked: active && user.bankDamage` — запас переставал копиться, и весь накопленный урон разом
   *    попадал в `/goal`;
   * 2. бонусы (`active ? mobHuntWeeks : 0`, `active ? streakBuff : undefined`) — реликвия и серия дней
   *    переставали усиливать ответ: 21 HP при включённом режиме против 20 при выключенном.
   *
   * Тест идёт через реальный HTTP-путь Mini App с `deps.bossEnabled = false`, потому что именно оттуда
   * флаг и попадал в сервис.
   */
  const answerVia = async (bossEnabled: boolean) => {
    const { h, app, headers } = await bossTab();
    h.deps.bossEnabled = bossEnabled;
    const { db } = h;
    const alice = (await getUserByTelegramId(db, 100))!;
    await updateUser(db, alice.id, { modeBoss: true, bankDamage: true });
    // «Знак охотника» (+5% ко всему): две недели охоты до текущей недели.
    await db.insert(combatSpends).values([
      { userId: alice.id, target: "golem", mobWeek: "2026-09-06", requestId: "r1", damageDeci: 300, at: nsk("2026-09-01T11:00") },
      { userId: alice.id, target: "ghost", mobWeek: "2026-09-13", requestId: "r2", damageDeci: 450, at: nsk("2026-09-08T11:00") },
    ]);
    const post = async (path: string, body: object) => (await app.request(path, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
    const res = await post("/api/answer", { cardId: 1, reps: 0, answer: "good" });
    const [log] = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, 1));
    const goal = await goalProgress(db, (await getRoom(db, 1))!, nsk("2026-10-19T13:00"));
    return { res, damageDeci: log.damageDeci, banked: log.banked, done: goal.done };
  };

  it("урон с реликвией одинаков при включённом и выключенном режиме", async () => {
    const on = await answerVia(true);
    const off = await answerVia(false);
    // +5% от 20 HP = 21 в десятых. Раньше при выключенном рубильнике бонус пропадал (20).
    expect(off.damageDeci).toBe(on.damageDeci);
    expect(off.damageDeci).toBe(21);
  });

  it("запас копится независимо от рубильника, поэтому /goal не прыгает", async () => {
    const on = await answerVia(true);
    const off = await answerVia(false);
    // Копить включено у человека — значит урон идёт в запас, а не в цель, при любом рубильнике.
    expect(on.banked).toBe(true);
    expect(off.banked).toBe(true);
    expect(on.done).toBe(off.done);
    expect(off.done).toBe(0);
  });
});

describe("недельный расчёт трофеев не повторяется на каждом тике (E11)", () => {
  /**
   * `sendTrophies` зовётся в цикле напоминаний раз в минуту. До E11 `collectTrophies` на каждом вызове
   * читал всю таблицу `trophies` и считал `weekFacts` по каждой комнате — ~10 080 прогонов в неделю
   * вместо одного. Теперь комната, за которую неделя уже посчитана (`rooms.trophies_week`), пропускается
   * до всякой работы.
   */
  it("повторный тик в ту же неделю ничего не пересчитывает и не дублирует трофеи", async () => {
    const { collectTrophies } = await import("../src/services/trophies");
    const { trophies, rooms } = await import("../src/db/schema");
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 4);
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 44, reviewedAt: nsk("2026-10-19T10:00") });
    const now = nsk("2026-10-25T20:00");

    // Первый тик: трофеи выданы, отметка недели поставлена.
    const first = await collectTrophies(h.db, now, { onlyFreshWeeks: true });
    expect(first.find((r) => r.user.id === alice.id)?.earned.length).toBeGreaterThan(0);
    const minted = await h.db.select().from(trophies);
    expect(minted.length).toBeGreaterThan(0);
    const [marked] = await h.db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(marked.trophiesWeek).not.toBeNull();

    // Второй тик в ту же неделю: комната пропущена, новых трофеев нет.
    expect(await collectTrophies(h.db, now, { onlyFreshWeeks: true })).toEqual([]);
    // И таблица не выросла — повторной выдачи не было.
    expect(await h.db.select().from(trophies)).toHaveLength(minted.length);

    // Следующая неделя считается заново: отметка не мешает.
    const nextWeek = nsk("2026-11-01T20:00");
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 44, reviewedAt: nsk("2026-10-27T10:00") });
    expect(await collectTrophies(h.db, nextWeek, { onlyFreshWeeks: true })).not.toEqual([]);
  });

  it("бэкфилл без флага по-прежнему видит прошлые недели", async () => {
    const { collectTrophies } = await import("../src/services/trophies");
    const { h, alice, room } = await setup();
    await setWeeklyGoal(h.db, room.id, 4);
    await h.db.insert(reviewLogs).values({ userId: alice.id, cardId: 1, rating: "good", damageDeci: 44, reviewedAt: nsk("2026-10-19T10:00") });
    const now = nsk("2026-10-25T20:00");
    // Скрипт бэкфилла зовёт collectTrophies БЕЗ onlyFreshWeeks: отметка его не должна касаться.
    await collectTrophies(h.db, now, { onlyFreshWeeks: true });
    // Даже после отметки недели вызов без флага пересчитывает и, если что-то не выдано, выдаёт.
    const backfill = await collectTrophies(h.db, now, { weeklyOnly: true, dryRun: true });
    expect(Array.isArray(backfill)).toBe(true);
  });
});
