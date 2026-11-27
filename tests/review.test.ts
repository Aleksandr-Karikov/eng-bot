import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { State } from "ts-fsrs";
import { cards as cardsTable, reviewLogs } from "../src/db/schema";
import { updateUser } from "../src/services/users";
import { createRoom, getRoom, joinRoom } from "../src/services/rooms";
import { goalProgress } from "../src/services/goals";
import { damageBalanceDeci } from "../src/services/combat-ledger";
import { answerCard, countDue, markKnown, nextDue, nextReviewAt } from "../src/services/review";
import { saveWord } from "../src/services/words";
import { DAY, MIN, T0, at, makeUser, testDb } from "./helpers";

async function setup() {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const bob = await makeUser(db, 2);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
  const add = async (term: string, now = T0) => {
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now });
    if (r.status !== "saved") throw new Error("dup");
    return r.word;
  };
  return { db, alice, bob, room, add };
}

describe("review", () => {
  it("serves due reviews before new cards, new cards oldest first", async () => {
    const { db, bob, add } = await setup();
    await add("first", T0);
    await add("second", at(MIN));
    const old = await add("old", T0);
    expect((await nextDue(db, bob.id, at(2 * MIN)))!.word.term).toBe("first");
    // "old" отвечаем Easy → становится Review; через 30 дней она просрочена и должна идти первой.
    await markKnown(db, { userId: bob.id, wordId: old.id, now: T0 });
    const later = at(30 * DAY);
    expect((await nextDue(db, bob.id, later))!.word.term).toBe("old");
    expect(await countDue(db, bob.id, later)).toBe(3);
  });

  it("answers a card, logs it and rejects stale presses", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("ok");
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("does not let a user answer someone else's card", async () => {
    const { db, alice, bob, add } = await setup();
    await add("word");
    const bobsCard = (await nextDue(db, bob.id, T0))!.card;
    expect(await answerCard(db, { userId: alice.id, cardId: bobsCard.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
  });

  it("markKnown pushes a new card far ahead and works once", async () => {
    const { db, bob, add } = await setup();
    const word = await add("word");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("ok");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("stale");
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const next = await nextReviewAt(db, bob.id);
    expect(next!.getTime() - T0.getTime()).toBeGreaterThanOrEqual(4 * DAY);
  });

  it("learns ahead: a just-failed card comes back in the same session", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "again", now: T0 });
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const again = await nextDue(db, bob.id, T0);
    expect(again?.card.id).toBe(item.card.id);
    expect(again?.card.state).not.toBe(State.New);
  });
});

/** Боевой режим включён: без него урон не начисляется и затухание нечего проверять. */
const setBossMode = (db: ReturnType<typeof testDb>, userId: number) => updateUser(db, userId, { modeBoss: true });

/** Урон в десятых HP по всем ответам карточки, в порядке ответов. */
async function damageAt(db: ReturnType<typeof testDb>, cardId: number): Promise<number[]> {
  const rows = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)).orderBy(reviewLogs.id);
  return rows.map((row) => row.damageDeci ?? -1);
}

/** Ответ на карточку в боевом режиме: `answerCard` с текущим `reps` и включённым уроном. */
const damageOf = async (db: ReturnType<typeof testDb>, userId: number, cardId: number, rating: "again" | "good", now: Date) => {
  const [c] = await db.select().from(cardsTable).where(eq(cardsTable.id, cardId));
  return answerCard(db, { userId, cardId, expectedReps: c.reps, answer: rating, now });
};

describe("урон за «Забыл» затухает по серии подряд", () => {
  /**
   * FSRS возвращает «Забыл» через минуту, поэтому одна карточка давала урон сколько угодно раз:
   * игрок жал «Забыл», получал HP за нажатие, и память тут ни при чём (E2). Затухание 1 → 0.5 → 0.25 → 0
   * привязано к серии подряд по этой карточке, а не к общему числу провалов.
   */

  it("снижает урон с каждым «Забыл» подряд и обнуляет с четвёртого", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    // Комнату делаем боевой: без этого урон не считается вовсе.
    await setBossMode(db, bob.id);
    const cardId = item.card.id;
    // Первый провал — полный урон 1 HP, дальше 0.5, 0.25 и 0.
    const first = await damageOf(db, bob.id, cardId, "again", T0);
    expect(first).toBe("ok");
    expect(await damageAt(db, cardId)).toEqual([10]);
    await damageOf(db, bob.id, cardId, "again", at(MIN));
    await damageOf(db, bob.id, cardId, "again", at(2 * MIN));
    await damageOf(db, bob.id, cardId, "again", at(3 * MIN));
    expect(await damageAt(db, cardId)).toEqual([10, 5, 3, 0]);
  });

  it("после «Помню» серия обрывается, и следующий «Забыл» снова полный", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    await setBossMode(db, bob.id);
    const cardId = item.card.id;
    await damageOf(db, bob.id, cardId, "again", T0);
    await damageOf(db, bob.id, cardId, "again", at(MIN));
    await damageOf(db, bob.id, cardId, "good", at(2 * MIN));
    await damageOf(db, bob.id, cardId, "again", at(3 * MIN));
    expect(await damageAt(db, cardId)).toEqual([10, 5, 20, 10]);
  });
});

describe("«уже знаю» — знакомство, а не работа (E5)", () => {
  /**
   * markKnown отправляет `easy` для новой карточки, поэтому раньше давал 3 HP за нажатие — максимум
   * базовой таблицы и больше, чем «Помню» после раздумий. Свайп «слово знакомо» не проверяет память,
   * значит и вклада в цель недели давать не должен. Карточка при этом закрывается как обычно.
   */
  it("не двигает цель комнаты, но убирает карточку из очереди", async () => {
    const { db, bob, add, room } = await setup();
    const word = await add("familiar");
    await setBossMode(db, bob.id);
    const before = await goalProgress(db, (await getRoom(db, room.id))!, T0);
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("ok");

    // Карточка ушла из очереди — знакомство засчитано.
    expect(await countDue(db, bob.id, T0)).toBe(0);
    // Знакомство не пополняет запас и не влияет на цель.
    const after = await goalProgress(db, (await getRoom(db, room.id))!, T0);
    expect(after.done).toBe(before.done);
    expect(await damageBalanceDeci(db, bob.id)).toBe(0);
    const [card] = await db.select().from(cardsTable).where(eq(cardsTable.userId, bob.id));
    expect(await damageAt(db, card.id)).toEqual([0]);
  });

  it("«Помню» на такой карточке пополняет энергию", async () => {
    const { db, bob, add } = await setup();
    await add("real");
    await setBossMode(db, bob.id);
    const item = (await nextDue(db, bob.id, T0))!;
    await damageOf(db, bob.id, item.card.id, "good", T0);
    expect(await damageAt(db, item.card.id)).toEqual([20]);
    const after = await goalProgress(db, (await getRoom(db, 1))!, T0);
    expect(after.done).toBe(0);
    expect(await damageBalanceDeci(db, bob.id)).toBe(20);
  });
});
