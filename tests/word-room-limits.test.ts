import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { rooms, usageCounters, users } from "../src/db/schema";
import { QUOTAS, checkAndCountWord, periodKey, quotaUsed, wordsLeft } from "../src/services/limits";
import { createRoom, deleteRoom, joinAllowed, joinRoom, memberCount, roomCreationAllowed } from "../src/services/rooms";
import { makeUser, T0, at, DAY, testDb } from "./helpers";
import { botHarness, type ApiCall } from "./bot-harness";

/**
 * Лимиты на слова и на комнаты (docs/limits-and-pricing.md, §2.2 и §2.3).
 *
 * Проверяется поведение, а не «счётчик вырос»: сколько слов человек реально добавляет, что видит на
 * пределе и что ему снова можно на следующий день. Комнаты — отдельный случай: там ограничено само
 * наличие, поэтому важно, что удаление возвращает место.
 */

const MSK = "Europe/Moscow";

const texts = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text ?? ""));

const refused = (h: ReturnType<typeof botHarness>, kind: keyof typeof QUOTAS) =>
  texts(h).some((t) => t.includes(QUOTAS[kind].refusal));

const buttons = (calls: ApiCall[]) =>
  calls.flatMap((c) => (c.payload.reply_markup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined)?.inline_keyboard?.flat() ?? []);

/** Нажатие «➕ Добавить» на последнем черновике — как это делает человек. */
async function confirmAdd(h: ReturnType<typeof botHarness>, userId: number, label = "➕ Добавить") {
  const button = [...buttons(h.calls)].reverse().find((b) => b.text.startsWith(label));
  if (!button) throw new Error(`Нет кнопки «${label}»`);
  await h.bot.handleUpdate(h.callback(userId, button.callback_data));
}

/** Комната, где человек уже состоит: без неё /add некуда сохранять. */
async function withRoom(h: ReturnType<typeof botHarness>, telegramId: number) {
  const user = await makeUser(h.db, telegramId);
  const room = await createRoom(h.db, { name: "Личная", createdBy: user.id, now: T0 });
  await h.db.update(users).set({ currentRoomId: room.id }).where(eq(users.id, user.id));
  const [fresh] = await h.db.select().from(users).where(eq(users.id, user.id));
  return { user: fresh, room };
}

describe("лимиты: новые слова", () => {
  it("дневной лимит: слово добавляется, пока есть место, и отказ приходит на входе", async () => {
    const h = botHarness();
    const { user } = await withRoom(h, 100);
    const limit = QUOTAS.add_word.limit;

    for (let i = 0; i < limit; i++) {
      await h.bot.handleUpdate(h.message(100, `/add word${i} — слово${i}`));
      await confirmAdd(h, 100);
    }
    expect(await quotaUsed(h.db, { userId: user.id, kind: "add_word", timeZone: MSK, now: T0 })).toBe(limit);

    await h.bot.handleUpdate(h.message(100, "/add лишнее — extra"));
    expect(refused(h, "add_word")).toBe(true);
  });

  it("отменённый черновик не съедает место", async () => {
    const h = botHarness();
    const { user } = await withRoom(h, 100);

    // Черновик подготовлен, но человек передумал и не подтвердил — счётчик должен остаться нулевым.
    await h.bot.handleUpdate(h.message(100, "/add serendipity — удача"));
    expect(await quotaUsed(h.db, { userId: user.id, kind: "add_word", timeZone: MSK, now: T0 })).toBe(0);

    // А после подтверждения — растёт на одно.
    await confirmAdd(h, 100);
    expect(await quotaUsed(h.db, { userId: user.id, kind: "add_word", timeZone: MSK, now: T0 })).toBe(1);
  });

  it("недельный лимит упирается раньше дневного и объясняет, что делать", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);
    const now = at(0);

    // Недельный счётчик на пределе, дневной пуст: 200 слов за неделю набраны, но сегодня ещё ничего.
    await db.insert(usageCounters).values({
      userId: user.id,
      period: periodKey("week", MSK, now),
      kind: "add_word_week",
      scope: "",
      count: QUOTAS.add_word_week.limit,
      updatedAt: now,
    });

    // Остаток показывает именно недельный лимит: обещать «ещё 50» нельзя — человек упрётся сразу.
    const left = await wordsLeft(db, { userId: user.id, timeZone: MSK, now });
    expect(left.kind).toBe("add_word_week");
    expect(left.used).toBe(QUOTAS.add_word_week.limit);
    expect(left.left).toBe(0);

    // И отказ объясняет, что делать до понедельника, а не только «нельзя».
    const state = await checkAndCountWord(db, { userId: user.id, timeZone: MSK, now });
    expect(state.allowed).toBe(false);
    expect(state.refusal).toBe(QUOTAS.add_word_week.refusal);
    expect(state.refusal).toContain("понедельник");
  });

  it("в начале недели счётчик пуст — недельный лимит не переносится", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);

    // Прошлая неделя выбрана целиком.
    await db.insert(usageCounters).values({
      userId: user.id,
      period: periodKey("week", MSK, T0),
      kind: "add_word_week",
      scope: "",
      count: QUOTAS.add_word_week.limit,
      updatedAt: T0,
    });

    // Через неделю — снова можно: лимит сбрасывается сам, админ ничего не включает руками.
    const left = await wordsLeft(db, { userId: user.id, timeZone: MSK, now: at(7 * DAY) });
    expect(left.used).toBe(0);
    expect(left.left).toBe(QUOTAS.add_word.limit);
  });

  it("отказ по недельному лимиту не сжигает дневной счётчик", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);
    const now = at(2 * DAY);

    // Забиваем недельный счётчик под потолок, дневной оставляем пустым.
    await db.insert(usageCounters).values({
      userId: user.id,
      period: periodKey("week", MSK, now),
      kind: "add_word_week",
      scope: "",
      count: QUOTAS.add_word_week.limit,
      updatedAt: now,
    });

    const state = await checkAndCountWord(db, { userId: user.id, timeZone: MSK, now });
    expect(state.allowed).toBe(false);

    // Дневной счётчик не тронут: отказ ничего не пишет, иначе запас сгорал бы на отказах.
    expect(await quotaUsed(db, { userId: user.id, kind: "add_word", timeZone: MSK, now })).toBe(0);
    const rows = await db
      .select()
      .from(usageCounters)
      .where(and(eq(usageCounters.userId, user.id), eq(usageCounters.kind, "add_word")));
    expect(rows).toHaveLength(0);
  });
});

describe("лимиты: комнаты", () => {
  it("создать можно три комнаты, четвёртая — отказ", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);

    for (let i = 0; i < 3; i++) {
      expect((await roomCreationAllowed(db, user.id)).allowed).toBe(true);
      await createRoom(db, { name: `R${i}`, createdBy: user.id, now: T0 });
    }

    const gate = await roomCreationAllowed(db, user.id);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.refusal).toContain("3 комнаты");
  });

  it("личные словари не считаются: английский и корейский не съедают место для друзей", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);

    await createRoom(db, { name: "English", createdBy: user.id, now: T0, personal: true });
    await createRoom(db, { name: "Korean", createdBy: user.id, now: T0, personal: true, language: "ko" });

    expect((await roomCreationAllowed(db, user.id)).allowed).toBe(true);
  });

  it("удаление комнаты возвращает место", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);

    for (let i = 0; i < 3; i++) await createRoom(db, { name: `R${i}`, createdBy: user.id, now: T0 });
    expect((await roomCreationAllowed(db, user.id)).allowed).toBe(false);

    // Удалили одну — и место снова есть: лимит про наличие, а не про число созданий за всё время.
    const [first] = await db.select().from(rooms).where(eq(rooms.createdBy, user.id));
    await deleteRoom(db, first.id);
    expect((await roomCreationAllowed(db, user.id)).allowed).toBe(true);
  });

  it("в комнату помещается 50 человек, пятьдесят первый ждёт отказа", async () => {
    const db = await testDb();
    const owner = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: owner.id, now: T0 });

    // Владелец уже внутри (`createRoom` добавляет его сам) — добираем до 50.
    for (let i = 1; i < 50; i++) {
      const member = await makeUser(db, 1000 + i);
      await joinRoom(db, { roomId: room.id, userId: member.id, now: T0, makeCurrent: false });
    }
    expect(await memberCount(db, room.id)).toBe(50);

    const extra = await makeUser(db, 9999);
    const gate = await joinAllowed(db, { roomId: room.id, userId: extra.id });
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.refusal).toContain("50 человек");
  });

  it("уже состоящий в комнате возвращается по старой ссылке, даже упёршись в лимит участий", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);
    const owner = await makeUser(db, 200);
    const room = await createRoom(db, { name: "R", createdBy: owner.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: user.id, now: T0, makeCurrent: false });

    // Набираем 20 участий — потолок.
    for (let i = 0; i < 20; i++) {
      const other = await createRoom(db, { name: `O${i}`, createdBy: owner.id, now: T0 });
      await joinRoom(db, { roomId: other.id, userId: user.id, now: T0, makeCurrent: false });
    }

    // Возврат в свою же комнату отказа быть не должен: иначе человек решит, что его выгнали.
    expect((await joinAllowed(db, { roomId: room.id, userId: user.id })).allowed).toBe(true);
  });

  it("незнакомец упирается в лимит участий и видит объяснение", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);
    const owner = await makeUser(db, 200);

    for (let i = 0; i < 20; i++) {
      const r = await createRoom(db, { name: `O${i}`, createdBy: owner.id, now: T0 });
      await joinRoom(db, { roomId: r.id, userId: user.id, now: T0, makeCurrent: false });
    }
    const target = await createRoom(db, { name: "Цель", createdBy: owner.id, now: T0 });

    const gate = await joinAllowed(db, { roomId: target.id, userId: user.id });
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.refusal).toContain("20 комнатах");
  });
});

describe("лимиты: комнаты через бота", () => {
  it("«Комната для друзей» на четвёртой отвечает отказом, а не создаёт молча", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    for (let i = 0; i < 3; i++) await createRoom(h.db, { name: `R${i}`, createdBy: user.id, now: T0 });

    // Именно так это выглядит для человека: команда и отказ в ответ.
    await h.bot.handleUpdate(h.message(100, "/newroom Четвёртая"));
    expect(texts(h).at(-1)).toContain("3 комнаты");
    // Именно три **дружеских**: личный словарь middleware заводит сам, и в лимит он не входит.
    const mine = (await h.db.select().from(rooms).where(eq(rooms.createdBy, user.id))).filter((r) => r.personalOf == null);
    expect(mine).toHaveLength(3);

    // А после удаления одной — снова можно.
    const [first] = await h.db.select().from(rooms).where(eq(rooms.createdBy, user.id));
    await deleteRoom(h.db, first.id);
    await h.bot.handleUpdate(h.message(100, "/newroom Пятая"));
    expect(texts(h).at(-1)).not.toContain("3 комнаты");
  });
});

describe("лимиты: /status", () => {
  it("админу видно и дневной, и недельный лимит на слова", async () => {
    const h = botHarness({ adminTelegramId: 100, status: statusFixture() });
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/status"));
    const text = texts(h).at(-1)!;

    // Лимиты печатаются по всем видам из QUOTAS — значит, новый вид появится в выводе сам.
    expect(text).toContain("Лимиты сегодня");
    expect(text).toContain(`Новые слова: 0 из ${QUOTAS.add_word.limit}`);
    expect(text).toContain(`Новые слова за неделю: 0 из ${QUOTAS.add_word_week.limit} на этой неделе`);

    // И расход в строке — живой, а не константа.
    const now = at(0);
    await h.db.insert(usageCounters).values({
      userId: 1,
      period: periodKey("day", MSK, now),
      kind: "add_word",
      scope: "",
      count: 7,
      updatedAt: now,
    });
    await h.bot.handleUpdate(h.message(100, "/status"));
    expect(texts(h).at(-1)).toContain(`Новые слова: 7 из ${QUOTAS.add_word.limit}`);
  });
});

/** Минимальное состояние бота для /status: проверяется только блок лимитов. */
function statusFixture() {
  return {
    startedAt: T0,
    llm: { provider: "openrouter", openRouterReady: true, use: () => "openrouter" },
    models: { main: "m", mnemonic: "", check: "" },
    images: { synth: "off" as const, background: false, style: "s" },
    secrets: { openRouter: true, imageApi: true },
    tools: { tts: "выключена", stt: false, youtube: false, frequency: false },
    app: { port: 0, urlSet: false, capturePort: 0 },
  };
}

describe("лимиты: админу можно", () => {
  it("админ заводит комнаты сверх лимита, обычный человек — нет", async () => {
    const db = await testDb();
    const admin = await makeUser(db, 100);
    const user = await makeUser(db, 200);
    for (let i = 0; i < 7; i++) await createRoom(db, { name: `R${i}`, createdBy: admin.id, now: T0 });

    // Семь комнат — это больше трёх, но админ не злоупотребляет: он ими работает.
    expect((await roomCreationAllowed(db, admin.id, { isAdmin: true })).allowed).toBe(true);
    // А тот же счёт без флага — по-прежнему отказ: лимит снимается только админу.
    expect((await roomCreationAllowed(db, admin.id)).allowed).toBe(false);
  });

  it("админ входит в переполненную комнату, а обычный человек — нет", async () => {
    const db = await testDb();
    const owner = await makeUser(db, 1);
    const admin = await makeUser(db, 100);
    const room = await createRoom(db, { name: "R", createdBy: owner.id, now: T0 });
    for (let i = 1; i < 50; i++) {
      const member = await makeUser(db, 1000 + i);
      await joinRoom(db, { roomId: room.id, userId: member.id, now: T0, makeCurrent: false });
    }

    expect((await joinAllowed(db, { roomId: room.id, userId: admin.id, isAdmin: true })).allowed).toBe(true);
    // Без флага тот же человек получает отказ: переполненная комната не впускает никого.
    expect((await joinAllowed(db, { roomId: room.id, userId: admin.id })).allowed).toBe(false);
  });

  it("/newroom у админа создаёт комнату даже на восьмую", async () => {
    const h = botHarness({ adminTelegramId: 100 });
    const admin = await makeUser(h.db, 100);
    for (let i = 0; i < 7; i++) await createRoom(h.db, { name: `R${i}`, createdBy: admin.id, now: T0 });

    await h.bot.handleUpdate(h.message(100, "/newroom Восьмая"));
    expect(texts(h).at(-1)).not.toContain("комнат");
    const mine = (await h.db.select().from(rooms).where(eq(rooms.createdBy, admin.id))).filter((r) => r.personalOf == null);
    expect(mine).toHaveLength(8);
  });

  it("обычному человеку тот же /newroom отвечает отказом", async () => {
    const h = botHarness({ adminTelegramId: 999 });
    const user = await makeUser(h.db, 100);
    for (let i = 0; i < 7; i++) await createRoom(h.db, { name: `R${i}`, createdBy: user.id, now: T0 });

    await h.bot.handleUpdate(h.message(100, "/newroom Восьмая"));
    expect(texts(h).at(-1)).toContain("7 комнат");
    const mine = (await h.db.select().from(rooms).where(eq(rooms.createdBy, user.id))).filter((r) => r.personalOf == null);
    expect(mine).toHaveLength(7);
  });
});

describe("лимиты: комнаты, заведённые до лимита", () => {
  it("старожилу отказ говорит правду о его числе комнат, а не «уже 3»", async () => {
    const db = await testDb();
    const user = await makeUser(db, 100);
    // Лимит ввели позже, чем появились комнаты: у человека их семь.
    for (let i = 0; i < 7; i++) await createRoom(db, { name: `R${i}`, createdBy: user.id, now: T0 });

    const gate = await roomCreationAllowed(db, user.id);
    expect(gate.allowed).toBe(false);
    // Врёт «уже 3» при семи на руках — и человек перестаёт верить остальным числам бота.
    expect(gate.allowed === false && gate.refusal).toContain("7 комнат");
    expect(gate.allowed === false && gate.refusal).not.toContain("уже создал 3");
  });
});
