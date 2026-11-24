import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { cards, combatSpends, dailySpend, duelPoints, reviewLogs, usageCounters } from "../src/db/schema";
import { RETENTION, storageReport, sweep } from "../src/services/sweep";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

/**
 * Уборка накопившегося (E29). Время управляемое: `now` передаётся параметром, поэтому проверяются
 * границы сроков, а не «примерно месяц назад».
 */
async function setup() {
  const db = testDb();
  const user = await makeUser(db, 1);
  const room = await createRoom(db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(db, { roomId: room.id, addedBy: user.id, draft: { term: "w", translation: "t", explanation: "", example: "" }, now: T0 });
  if (saved.status !== "saved") throw new Error("fixture");
  const [card] = await db.select().from(cards).where(eq(cards.userId, user.id));
  return { db, user, room, card };
}

describe("уборка служебных таблиц (E29)", () => {
  it("удаляет счётчики квот старше срока и оставляет свежие", async () => {
    const { db, user } = await setup();
    const now = at(100 * DAY);
    await db.insert(usageCounters).values([
      { userId: user.id, period: "старый", kind: "explain", scope: "", count: 1, updatedAt: at(40 * DAY) },
      { userId: user.id, period: "свежий", kind: "explain", scope: "", count: 1, updatedAt: at(95 * DAY) },
    ]);
    const result = await sweep(db, { now });
    expect(result.usageCounters).toBe(1);
    const left = await db.select().from(usageCounters);
    expect(left.map((r) => r.period)).toEqual(["свежий"]);
    expect(RETENTION.usageCountersDays).toBe(30);
  });

  it("удаляет расход на модель и траты в бою по своим срокам", async () => {
    const { db, user, room } = await setup();
    const now = at(100 * DAY);
    await db.insert(dailySpend).values([
      { day: "старый", kind: "image", count: 1, updatedAt: at(40 * DAY) },
      { day: "свежий", kind: "image", count: 1, updatedAt: at(95 * DAY) },
    ]);
    await db.insert(combatSpends).values([
      { userId: user.id, target: "boss", roomId: room.id, requestId: "old", damageDeci: 10, at: at(20 * DAY) },
      { userId: user.id, target: "boss", roomId: room.id, requestId: "new", damageDeci: 10, at: at(95 * DAY) },
    ]);
    const result = await sweep(db, { now });
    expect(result.dailySpend).toBe(1);
    expect(result.combatSpends).toBe(1);
    // `now` = at(100 дней); срок боя 56 дней, значит граница — at(44 дня): at(20) старше, at(95) свежее.
    expect(RETENTION.combatSpendsDays).toBe(56);
  });

  it("дуэльные очки чистятся по сроку, трофеи не трогаются", async () => {
    const { db, user, room } = await setup();
    const now = at(100 * DAY);
    await db.insert(duelPoints).values([
      { roomId: room.id, userId: user.id, createdAt: at(20 * DAY) },
      { roomId: room.id, userId: user.id, createdAt: at(95 * DAY) },
    ]);
    const result = await sweep(db, { now });
    expect(result.duelPoints).toBe(1);
  });
});

describe("снимок before хранится только у последней строки (E29)", () => {
  it("обнуляет before у всех, кроме последней по карточке", async () => {
    const { db, user, card } = await setup();
    for (let i = 0; i < 3; i++) {
      await db.insert(reviewLogs).values({
        userId: user.id, cardId: card.id, rating: "good", reviewedAt: at(i * DAY),
        before: JSON.stringify({ due: 0, state: 1, reps: i, stability: 1, fsrs: "{}" }),
      });
    }
    const now = at(10 * DAY);
    const result = await sweep(db, { now });
    expect(result.beforeCleared).toBe(2);
    const rows = await db.select().from(reviewLogs).orderBy(reviewLogs.id);
    // Последняя (по ней работает «↩️ Отменить») сохранила снимок, остальные — нет.
    expect(rows[0].before).toBeNull();
    expect(rows[1].before).toBeNull();
    expect(rows[2].before).not.toBeNull();
    // История не удалена: это история обучения.
    expect(rows).toHaveLength(3);
  });

  it("повторный проход ничего не меняет", async () => {
    const { db, user, card } = await setup();
    await db.insert(reviewLogs).values({
      userId: user.id, cardId: card.id, rating: "good", reviewedAt: at(DAY),
      before: JSON.stringify({ due: 0, state: 1, reps: 0, stability: 1, fsrs: "{}" }),
    });
    expect((await sweep(db, { now: at(5 * DAY) })).beforeCleared).toBe(0);
    expect((await sweep(db, { now: at(5 * DAY) })).beforeCleared).toBe(0);
  });
});

describe("файлы (E29)", () => {
  it("аудио чистится по списку текущих слов", async () => {
    const { db, card } = await setup();
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    const wordId = card.wordId;
    writeFileSync(join(dir, `${wordId}-uk-abcdef.m4a`), "x");
    writeFileSync(join(dir, "99999-uk-abcdef.m4a"), "x"); // слова с таким id нет
    const result = await sweep(db, { now: at(DAY), audioDir: dir });
    expect(result.audioFiles).toBe(1);
    expect(readdirSync(dir)).toEqual([`${wordId}-uk-abcdef.m4a`]);
  });

  it("голосовые записи чистятся по возрасту", async () => {
    const { db } = await setup();
    const dir = mkdtempSync(join(tmpdir(), "voice-"));
    const old = join(dir, "old.wav");
    const fresh = join(dir, "fresh.wav");
    writeFileSync(old, "x");
    writeFileSync(fresh, "x");
    const now = at(100 * DAY);
    utimesSync(old, at(50 * DAY), at(50 * DAY));
    utimesSync(fresh, at(99 * DAY), at(99 * DAY));
    const result = await sweep(db, { now, voiceSamplesDir: dir });
    expect(result.voiceFiles).toBe(1);
    expect(readdirSync(dir)).toEqual(["fresh.wav"]);
  });

  it("storageReport показывает накопленное и ничего не меняет", async () => {
    const { db, user, card } = await setup();
    await db.insert(reviewLogs).values({ userId: user.id, cardId: card.id, rating: "good", reviewedAt: at(DAY), before: "{}" });
    const report = await storageReport(db);
    expect(report.reviewLogs).toBe(1);
    expect(report.withBefore).toBe(1);
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });
});
