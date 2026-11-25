import { describe, expect, it } from "vitest";
import { cards as cardsTable, words } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { answerCard, countDueSplit, dueQueue, markKnown, newPortion, nextDue } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { reminderText } from "../src/bot/texts";
import { botHarness, buttonData } from "./bot-harness";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

/**
 * Дневная порция новых слов (E30).
 *
 * Раньше потолка не было: слово друга появлялось в очереди сразу, а повторения стоят впереди новых.
 * При большом словаре это давало либо вечный долг (до новых не дойти), либо пачку, которую не выучить.
 */

async function setup(terms: string[], newPerDay?: number) {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  for (const term of terms) {
    const saved = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
    if (saved.status !== "saved") throw new Error(`dup: ${term}`);
  }
  const user = newPerDay === undefined ? alice : await updateUser(db, alice.id, { newPerDay });
  return { db, user, room };
}

/** Ответить по карточке, которую отдаёт очередь. */
async function answerNext(db: ReturnType<typeof testDb>, userId: number, now: Date, answer: "good" | "again" = "good") {
  const item = (await nextDue(db, userId, now))!;
  await answerCard(db, { userId, cardId: item.card.id, expectedReps: item.card.reps, answer, now });
  return item;
}

/**
 * Какие новые слова очередь ещё пускает. Смотрим именно на новые: `nextDue` после ответов отдаёт
 * карточку «на 20 минут вперёд» — это начатые слова, а не превышение порции.
 */
async function newTerms(db: ReturnType<typeof testDb>, userId: number, now: Date) {
  return (await dueQueue(db, userId, now, 100)).filter((i) => i.card.state === 0).map((i) => i.word.term);
}

/** Ответить по следующему НОВОМУ слову: начатые карточки очередь отдаёт раньше, и порцию они не тратят. */
async function answerNextNew(db: ReturnType<typeof testDb>, userId: number, now: Date) {
  const item = (await dueQueue(db, userId, now, 100)).find((i) => i.card.state === 0)!;
  await answerCard(db, { userId, cardId: item.card.id, expectedReps: item.card.reps, answer: "good", now });
  return item;
}

describe("дневная порция новых слов", () => {
  it("показывает не больше порции за сутки, остальные ждут следующего дня", async () => {
    const { db, user } = await setup(["a", "b", "c", "d", "e"], 3);

    for (let i = 0; i < 3; i++) await answerNextNew(db, user.id, at(i * 1000));
    // Четвёртого нового слова в этот день нет: порция выбрана.
    expect(await newTerms(db, user.id, at(5000))).toEqual([]);

    // На следующий день порция снова полная — и приходит следующее слово, а не всё сразу.
    const tomorrow = at(DAY + 1000);
    expect(await newTerms(db, user.id, tomorrow)).toEqual(["d", "e"]);
    await answerNextNew(db, user.id, tomorrow);
    await answerNextNew(db, user.id, tomorrow);
    expect(await newTerms(db, user.id, tomorrow)).toEqual([]);
  });

  it("порция не накапливается: пропущенный день её не увеличивает", async () => {
    const { db, user } = await setup(["a", "b", "c", "d", "e"], 2);
    // Два дня ничего не делали — на третий всё равно только два новых.
    const later = at(3 * DAY);
    expect(await newTerms(db, user.id, later)).toHaveLength(2);
    await answerNextNew(db, user.id, later);
    await answerNextNew(db, user.id, later);
    expect(await newTerms(db, user.id, later)).toEqual([]);
  });

  it("порядок внутри порции — по полезности, а не по дате добавления", async () => {
    const { db, user } = await setup(["rare", "common", "so-so"], 2);
    const rate = async (term: string, usefulness: number) => {
      await db.update(words).set({ usefulness }).where(eq(words.term, term));
    };
    await rate("rare", 1);
    await rate("common", 3);
    await rate("so-so", 2);

    const queue = await dueQueue(db, user.id, at(1000), 10);
    // 🟢 ходовое и 🟡 среднее впереди ⚪️ редкого: время на зубрёжку идёт на то, что пригодится.
    expect(queue.map((i) => i.word.term)).toEqual(["common", "so-so"]);
  });

  it("повторения приходят всегда, даже когда порция новых выбрана", async () => {
    const { db, user } = await setup(["a", "b"], 1);
    // Первое слово выучено и вернулось на повторение, второе — ещё новое.
    const first = await answerNext(db, user.id, at(1000));
    await answerNext(db, user.id, at(2000)); // второе — порция выбрана
    expect(await newTerms(db, user.id, at(3000))).toEqual([]);

    // Повторение (не новое) не режется порцией: сдвигаем срок и проверяем, что оно вышло.
    await db.update(cardsTable).set({ due: at(4000) }).where(eq(cardsTable.id, first.card.id));
    const due = await nextDue(db, user.id, at(4000));
    expect(due?.card.id).toBe(first.card.id);
    expect(due?.card.state).not.toBe(0);
  });

  it("«✅ Знаю» не тратит порцию: это отказ от учёбы, а не знакомство", async () => {
    const { db, user } = await setup(["a", "b", "c"], 1);
    const [known] = await db.select({ id: words.id }).from(words).where(eq(words.term, "a"));
    await markKnown(db, { userId: user.id, wordId: known.id, now: at(1000) });
    // Порция не тронута — новое слово всё ещё доступно.
    expect((await newPortion(db, user.id, at(2000))).introduced).toBe(0);
    expect(await nextDue(db, user.id, at(2000))).toBeDefined();
  });

  it("повторный ответ по той же карточке не съедает второе место", async () => {
    const { db, user } = await setup(["a", "b", "c"], 2);
    const first = await answerNext(db, user.id, at(1000));
    // «Забыл» возвращает карточку через минуту — второй ответ по ней не должен считаться новым знакомством.
    await answerNext(db, user.id, at(2000));
    await db.update(cardsTable).set({ due: at(3000) }).where(eq(cardsTable.id, first.card.id));
    const item = (await nextDue(db, user.id, at(3000)))!;
    expect(item.card.id).toBe(first.card.id);
    await answerCard(db, { userId: user.id, cardId: item.card.id, expectedReps: item.card.reps, answer: "good", now: at(3000) });
    expect((await newPortion(db, user.id, at(3500))).introduced).toBe(2);
  });

  it("ноль — без ограничения: приходят все новые", async () => {
    const { db, user } = await setup(["a", "b", "c", "d", "e"], 0);
    for (let i = 0; i < 5; i++) await answerNext(db, user.id, at(i * 1000));
    expect(await newTerms(db, user.id, at(6000))).toEqual([]);
    expect((await newPortion(db, user.id, at(6000))).left).toBeNull();
  });

  it("полночь по поясу человека возвращает порцию", async () => {
    const { db, user } = await setup(["a", "b"], 1);
    await answerNext(db, user.id, at(1000));
    expect(await newTerms(db, user.id, at(2 * 60 * 60_000))).toEqual([]);
    // T0 = 16:00 по Новосибирску, до полуночи ещё 8 часов — вот там порция открывается снова.
    expect(await newTerms(db, user.id, at(9 * 60 * 60_000))).toEqual(["b"]);
  });

  it("считает очередь и ожидающих двумя числами", async () => {
    const { db, user } = await setup(["a", "b", "c", "d", "e"], 2);
    const split = await countDueSplit(db, user.id, at(1000));
    expect(split).toEqual({ review: 0, fresh: 2, waiting: 3, activeFull: false });
    // Текст напоминания спокойный: запас, а не долг.
    expect(reminderText(split)).toBe("🆕 2 новых слова ждут знакомства\n📚 Ещё 3 новых слова ждут своей очереди.");
  });

  it("порция настраивается кнопкой в /settings и сразу меняет очередь", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    for (const term of ["a", "b", "c", "d", "e", "f"]) {
      await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: "t", explanation: "", example: "" }, now: T0 });
    }
    expect((await nextDue(h.db, user.id, at(1000)))!.card.state).toBe(0);

    // Открываем экран порции и выбираем «5».
    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🆕 Новые слова в день")));
    expect(h.calls.at(-1)?.method).toBe("editMessageText");
    expect(String((h.calls.at(-1)?.payload as { text?: string }).text)).toContain("15");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "⬜️ 5")));

    // Пять — значит из шести новых за день доступны ровно пять.
    const queue = await dueQueue(h.db, user.id, at(2000), 100);
    expect(queue).toHaveLength(5);
    expect(await newPortion(h.db, user.id, at(2000))).toMatchObject({ limit: 5, left: 5 });
  });

  it("чужое число от кнопки не попадает в настройку", async () => {
    const { db, user } = await setup(["a"], 10);
    // Значение вне списка вариантов невозможно получить через UI, но клиент может прислать своё.
    const { appChangeSetting } = await import("../src/app/manage");
    const deps = { db, now: () => at(1000), bossEnabled: true } as never;
    const changed = await appChangeSetting(deps, user, { newPerDay: 999 });
    expect(changed).toMatchObject({ ok: false });
  });
});
