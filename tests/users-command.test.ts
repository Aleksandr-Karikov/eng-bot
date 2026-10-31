import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { listUsers } from "../src/services/user-list";
import { createRoom } from "../src/services/rooms";
import { answerCard } from "../src/services/review";
import { saveWord } from "../src/services/words";
import { setSourceOnce, upsertUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

const ADMIN = 999;
const STRANGER = 555;

const lastText = (h: ReturnType<typeof botHarness>) => {
  const calls = h.calls.filter((c) => c.method === "sendMessage");
  return String(calls[calls.length - 1]?.payload.text ?? "");
};
const allText = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text ?? "")).join("\n");

/** Человек со словами и одним повторением в пределах недели. */
async function active(db: ReturnType<typeof testDb>, telegramId: number, firstName: string) {
  const user = await makeUser(db, telegramId, firstName);
  const room = await createRoom(db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of ["bank", "river"]) {
    await saveWord(db, { roomId: room.id, addedBy: user.id, draft: { term, translation: term, explanation: "", example: "" }, now: T0 });
  }
  const [card] = await db.select().from(cards).where(eq(cards.userId, user.id));
  await answerCard(db, { userId: user.id, cardId: card.id, expectedReps: 0, answer: "good", now: T0 });
  return user;
}

describe("listUsers", () => {
  it("returns nothing when there is no one", async () => {
    expect(await listUsers(testDb(), T0)).toEqual([]);
  });

  it("aggregates words and 7-day reviews, newest first", async () => {
    const db = testDb();
    const old = await upsertUser(db, { id: 1, first_name: "Old" }, at(-DAY));
    const fresh = await upsertUser(db, { id: 2, first_name: "Fresh" }, T0);
    const room = await createRoom(db, { name: "R", createdBy: old.id, now: T0 });
    for (const term of ["a", "b"]) {
      await saveWord(db, { roomId: room.id, addedBy: old.id, draft: { term, translation: "t", explanation: "", example: "" }, now: T0 });
    }
    const [card] = await db.select().from(cards).where(eq(cards.userId, old.id));
    await answerCard(db, { userId: old.id, cardId: card.id, expectedReps: 0, answer: "good", now: T0 });

    const rows = await listUsers(db, T0);
    expect(rows.map((r) => r.firstName)).toEqual(["Fresh", "Old"]);
    expect(rows.find((r) => r.id === old.id)).toMatchObject({ words: 2, reviews7d: 1 });
    expect(rows.find((r) => r.id === fresh.id)).toMatchObject({ words: 0, reviews7d: 0 });
  });

  it("does not count reviews older than a week", async () => {
    const db = testDb();
    const user = await makeUser(db, 1, "Alice");
    const room = await createRoom(db, { name: "R", createdBy: user.id, now: T0 });
    await saveWord(db, { roomId: room.id, addedBy: user.id, draft: { term: "a", translation: "t", explanation: "", example: "" }, now: T0 });
    const [card] = await db.select().from(cards).where(eq(cards.userId, user.id));
    await answerCard(db, { userId: user.id, cardId: card.id, expectedReps: 0, answer: "good", now: at(-10 * DAY) });
    expect((await listUsers(db, T0))[0]).toMatchObject({ reviews7d: 0 });
  });
});

describe("/users", () => {
  it("shows the admin who is in the bot and how active they are", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    const alice = await active(h.db, 101, "Alice");
    await setSourceOnce(h.db, alice.id, "join_ABC", T0);
    await h.bot.handleUpdate(h.message(ADMIN, "/users"));
    const text = allText(h);
    expect(text).toContain("👥 <b>Пользователи</b>");
    expect(text).toContain("<b>Alice</b>");
    expect(text).toContain("2 сл., 1 повт/нед");
    expect(text).toContain("id 101");
    expect(text).toContain("с 15.10");
    expect(text).toContain("join_ABC");
  });

  it("keeps the command to the admin", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    await h.bot.handleUpdate(h.message(STRANGER, "/users"));
    expect(lastText(h)).toBe("Команда только для админа.");
  });

  it("shows a single person by id or @username, not the whole list", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    const alice = await upsertUser(h.db, { id: 101, first_name: "Alice", username: "alice" }, T0);
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: alice.id, draft: { term: "bank", translation: "t", explanation: "", example: "" }, now: T0 });
    await makeUser(h.db, 202, "Bob");

    await h.bot.handleUpdate(h.message(ADMIN, "/users 101"));
    await h.bot.handleUpdate(h.message(ADMIN, "/users @alice"));
    const text = allText(h);
    expect(text).toContain("<b>Alice</b>");
    expect(text).not.toContain("<b>Bob</b>");
  });

  it("lists the newest users first", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    await upsertUser(h.db, { id: 202, first_name: "Bob" }, at(-DAY));
    await upsertUser(h.db, { id: 101, first_name: "Alice" }, T0);
    await h.bot.handleUpdate(h.message(ADMIN, "/users"));
    const text = allText(h);
    expect(text.indexOf("<b>Alice</b>")).toBeLessThan(text.indexOf("<b>Bob</b>"));
  });

  it("says so when nobody matches the argument", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    await h.bot.handleUpdate(h.message(ADMIN, "/users 777"));
    expect(lastText(h)).toContain("Никого не нашёл");
  });
});
