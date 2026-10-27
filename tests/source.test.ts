import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { getUser } from "../src/services/users";
import { DIRECT_SOURCE, MAX_SOURCE, parseStartPayload } from "../src/services/source";
import { sourceLines, sourceSummary } from "../src/services/sources";
import { createRoom } from "../src/services/rooms";
import { botHarness } from "./bot-harness";
import { DAY, T0, at, makeUser } from "./helpers";

const sourceOf = async (h: ReturnType<typeof botHarness>, id: number) => (await getUser(h.db, id))?.source;

describe("🔗 разбор ?start=", () => {
  it("пустой payload — «пришёл сам», а не пустая строка", () => {
    expect(parseStartPayload("")).toBe(DIRECT_SOURCE);
    expect(parseStartPayload("   ")).toBe(DIRECT_SOURCE);
    expect(parseStartPayload(undefined)).toBe(DIRECT_SOURCE);
  });

  it("незнакомый payload доезжает буквально: habr так habr", () => {
    expect(parseStartPayload("habr")).toBe("habr");
    expect(parseStartPayload(" ielts_chat ")).toBe("ielts_chat");
  });

  it("ссылка на набор помечается как набор, приглашение в комнату — как есть", () => {
    expect(parseStartPayload("s_a1")).toBe("set_a1");
    expect(parseStartPayload("s_phrasal")).toBe("set_phrasal");
    expect(parseStartPayload("join_abc123")).toBe("join_abc123");
  });

  it("мусор на килобайт обрезается: колонка текстовая, но не безразмерная", () => {
    expect(parseStartPayload("x".repeat(500))).toHaveLength(MAX_SOURCE);
  });
});

describe("🔗 источник в /start", () => {
  it("пришёл по ссылке — источник записан вместе со временем", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 200);
    await h.bot.handleUpdate(h.message(200, "/start habr"));
    expect((await getUser(h.db, user.id))?.sourceAt).toEqual(T0);
    expect(await sourceOf(h, user.id)).toBe("habr");
  });

  it("второй переход по другой ссылке историю не переписывает", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 201);
    await h.bot.handleUpdate(h.message(201, "/start habr"));
    await h.bot.handleUpdate(h.message(201, "/start vc"));
    expect(await sourceOf(h, user.id)).toBe("habr");
  });

  it("пришёл без ссылки — тоже источник: «direct» отличается от «неизвестно»", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 202);
    await h.bot.handleUpdate(h.message(202, "/start"));
    expect(await sourceOf(h, user.id)).toBe(DIRECT_SOURCE);
  });

  it("приглашение в комнату: и в комнату вступает, и источник помечен", async () => {
    const h = botHarness();
    const owner = await makeUser(h.db, 203);
    const room = await createRoom(h.db, { name: "Друзья", createdBy: owner.id, now: T0 });
    const guest = await makeUser(h.db, 204);
    await h.bot.handleUpdate(h.message(204, `/start join_${room.inviteCode}`));
    expect((await getUser(h.db, guest.id))?.currentRoomId).toBe(room.id);
    expect(await sourceOf(h, guest.id)).toBe(`join_${room.inviteCode}`);
  });

  it("битая ссылка-приглашение всё равно помечает источник", async () => {
    const h = botHarness();
    // Новичок приходит по недействительной ссылке: в комнату не попадёт, но «откуда пришёл» знать надо.
    await h.bot.handleUpdate(h.message(205, "/start join_нетакой"));
    const [saved] = await h.db.select().from(users).where(eq(users.telegramId, 205));
    expect(saved?.source).toBe("join_нетакой");
  });
});

describe("🔗 сводка источников", () => {
  it("ответивший на 8-й день считается вернувшимся, молчащий — нет", async () => {
    const h = botHarness();
    const back = await makeUser(h.db, 300);
    const gone = await makeUser(h.db, 301);
    for (const id of [back.id, gone.id]) await h.db.update(users).set({ source: "habr", sourceAt: T0 }).where(eq(users.id, id));
    // Ответ на 8-й день — после порога. Второй не ответил ни разу.
    await answerOn(h, back.id, at(8 * DAY));

    expect((await sourceSummary(h.db, at(10 * DAY))).find((r) => r.source === "habr")).toEqual({ source: "habr", arrived: 2, returned: 1 });
  });

  it("пока неделя не прошла — «рано», а не «не вернулся»", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 302);
    await h.db.update(users).set({ source: "vc", sourceAt: T0 }).where(eq(users.id, user.id));

    const rows = await sourceSummary(h.db, at(3 * DAY));
    expect(rows.find((r) => r.source === "vc")?.returned).toBeNull();
    expect(sourceLines(rows).join(" ")).toContain("рано");
  });

  it("без источников сводка честно говорит, что их нет, а не «0 человек»", async () => {
    const h = botHarness();
    await makeUser(h.db, 303);
    expect(sourceLines(await sourceSummary(h.db, T0)).join(" ")).toContain("источники появятся");
  });
});

/** Ответ человека в момент when — через настоящий путь ответа, чтобы запись в review_logs была как в жизни. */
async function answerOn(h: ReturnType<typeof botHarness>, userId: number, when: Date): Promise<void> {
  const { ensurePersonalRoom } = await import("../src/services/rooms");
  const { saveWord } = await import("../src/services/words");
  const { answerCard } = await import("../src/services/review");
  const { cards } = await import("../src/db/schema");
  const room = await ensurePersonalRoom(h.db, userId, T0);
  const saved = await saveWord(h.db, { roomId: room.id, addedBy: userId, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  if (saved.status !== "saved") return;
  // saveWord возвращает слово; карточка — на пару (человек, слово).
  const [card] = await h.db.select().from(cards).where(and(eq(cards.userId, userId), eq(cards.wordId, saved.word.id)));
  if (card) await answerCard(h.db, { userId, cardId: card.id, expectedReps: card.reps, answer: "good", now: when });
}
