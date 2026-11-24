import { HUNTER_RELICS, MOBS } from "../combat-mobs";
import { KNOW_STAGE, answerWeight, againStreak, damageSkill } from "./goals";
import { damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment, roomTimeZone } from "./digest";
import { bossOf, weeklyOpponent } from "./boss";
import { getRoom } from "./rooms";
import { streakBuff } from "./streak-buff";
import { inCurrentLanguage } from "./language";
import { and, asc, count, desc, eq, gte, isNull, lt, lte, ne, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, combatArchive, reviewLogs, words, users, type CardRow, type Word } from "../db/schema";
import { localMoment, localParts, nextDate } from "../time";
import { DEFAULT_TIMEZONE } from "./users";
import { review, type Answer } from "../srs/srs";

export interface DueItem {
  card: CardRow;
  word: Word;
}

export const LEARN_AHEAD_MS = 20 * 60_000;

/** Сколько новых слов в день показывать, пока человек не выбрал своё. Совпадает с default колонки `users.new_per_day`. */
export const DEFAULT_NEW_PER_DAY = 15;

/**
 * Дневная порция новых слов (E30).
 *
 * Повторения не ограничены никогда: просроченное — это то, что уже начало забываться, и отложить его
 * значит потерять. Ограничение касается только знакомства с новыми словами: друзья добавляют пачками,
 * и без потолка либо новые не доходят никогда (`compareQueue` ставит повторения впереди), либо падают
 * все разом и не успевают заучиваться.
 */
export interface NewPortion {
  /** Потолок новых на день; 0 — без ограничения. */
  limit: number;
  /** Сколько новых уже введено сегодня. */
  introduced: number;
  /** Сколько новых ещё можно показать сегодня; null — без ограничения. */
  left: number | null;
}

/**
 * Сколько новых слов человек ввёл сегодня по своим локальным суткам.
 *
 * «Ввёл» — это **первый ответ по карточке**, а не факт добавления: слово, пришедшее от друга, ничего
 * не стоит, пока его не показали, и считать надо именно знакомство. Поэтому ответы по карточке, у
 * которой уже есть более ранний ответ, не считаются — иначе карточка, забытая сегодня дважды,
 * съедала бы три места из порции.
 *
 * «✅ Знаю» (`stage = "know"`) не считается: это отказ от учёбы, а не знакомство. Иначе человек,
 * отметивший десять слов как известные, упирался бы в потолок, не выучив ни одного.
 *
 * Отдельного счётчика нет намеренно: он разъехался бы с реальностью (пропуск дня, отмена ответа,
 * удаление карточки), а этот запрос — один `NOT EXISTS` по индексу `(card_id)`; на копии прод-базы
 * тысяча вызовов занимает 1 мс.
 */
async function introducedToday(db: Db, userId: number, now: Date, timeZone: string): Promise<number> {
  const { date } = localParts(timeZone, now);
  const start = localMoment(timeZone, date, "00:00");
  const end = localMoment(timeZone, nextDate(date), "00:00");
  // Псевдоним обязателен: без него внутренний FROM затеняет внешний, и подзапрос сравнивал бы строку сама с собой.
  const earlier = alias(reviewLogs, "earlier");
  const [row] = await db
    .select({ n: count() })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.reviewedAt, start),
        lt(reviewLogs.reviewedAt, end),
        or(isNull(reviewLogs.stage), ne(reviewLogs.stage, KNOW_STAGE)),
        notExists(
          db
            .select({ id: earlier.id })
            .from(earlier)
            .where(
              and(
                eq(earlier.userId, reviewLogs.userId),
                eq(earlier.cardId, reviewLogs.cardId),
                lt(earlier.reviewedAt, reviewLogs.reviewedAt),
              ),
            ),
        ),
      ),
    );
  return row?.n ?? 0;
}

/** Остаток дневной порции новых. `limit = 0` — человек выбрал «без ограничения», счётчики не нужны. */
export async function newPortion(db: Db, userId: number, now: Date): Promise<NewPortion> {
  const [user] = await db.select({ newPerDay: users.newPerDay, timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const limit = user?.newPerDay ?? DEFAULT_NEW_PER_DAY;
  if (limit <= 0) return { limit: 0, introduced: 0, left: null };
  const introduced = await introducedToday(db, userId, now, user?.timezone ?? DEFAULT_TIMEZONE);
  return { limit, introduced, left: Math.max(0, limit - introduced) };
}

/**
 * Убирает из очереди те новые, что не влезают в остаток порции. Повторения проходят все.
 * Порядок не меняется: очередь уже отсортирована `compareQueue`, и знакомство идёт по полезности.
 */
function withinPortion(items: DueItem[], left: number | null): DueItem[] {
  if (left === null) return items;
  const out: DueItem[] = [];
  let fresh = 0;
  for (const item of items) {
    if (item.card.state !== State.New) out.push(item);
    else if (fresh < left) {
      out.push(item);
      fresh++;
    }
  }
  return out;
}

function compareQueue(a: DueItem, b: DueItem): number {
  const aNew = a.card.state === State.New ? 1 : 0;
  const bNew = b.card.state === State.New ? 1 : 0;
  if (aNew !== bNew) return aNew - bNew;
  // Новые — сначала самые полезные: время на зубрёжку тратится на то, что пригодится.
  if (aNew) return (b.word.usefulness ?? 2) - (a.word.usefulness ?? 2) || a.card.createdAt.getTime() - b.card.createdAt.getTime() || a.card.id - b.card.id;
  return a.card.due.getTime() - b.card.due.getTime();
}

async function dueItems(db: Db, userId: number, until: Date): Promise<DueItem[]> {
  const rows = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, userId), lte(cards.due, until)));
  return (await inCurrentLanguage(db, rows)).sort(compareQueue);
}

export async function nextDue(db: Db, userId: number, now: Date): Promise<DueItem | undefined> {
  // Порция считается один раз и на основной список, и на запас «на 20 минут вперёд»: запас нужен,
  // чтобы вернуть забытую в этой же сессии карточку, а не чтобы обойти дневной потолок.
  const portion = await newPortion(db, userId, now);
  const [item] = withinPortion(await dueItems(db, userId, now), portion.left);
  if (item) return item;
  const [ahead] = withinPortion(await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS)), portion.left);
  return ahead;
}

/** Очередь /learn целиком (с тем же запасом «на 20 минут вперёд», что у nextDue) — для Mini App, которое грузит карточки заранее. */
export async function dueQueue(db: Db, userId: number, now: Date, limit: number): Promise<DueItem[]> {
  const portion = await newPortion(db, userId, now);
  const items = await dueItems(db, userId, now);
  const list = items.length ? items : await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return withinPortion(list, portion.left).slice(0, limit);
}

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  // Считает каждую минуту для напоминаний — без загрузки самих карточек и слов.
  const [row] = await db.select({ n: count() }).from(cards).where(and(eq(cards.userId, userId), lte(cards.due, now)));
  return row?.n ?? 0;
}

/**
 * К повторению отдельно от новых: пачка слов друга — это знакомство, а не «40 слов ждут повторения».
 *
 * `fresh` — сколько новых **можно показать сегодня** (уже с учётом дневной порции), `waiting` — сколько
 * новых ждут своей очереди сверх неё. Два числа, а не одно, потому что «сегодня 15 новых, ещё 105 ждут»
 * и «120 новых ждут знакомства» — разные сообщения: второе пугает и толкает закрыть бота.
 */
export async function countDueSplit(db: Db, userId: number, now: Date): Promise<{ review: number; fresh: number; waiting: number }> {
  const due = and(eq(cards.userId, userId), lte(cards.due, now));
  const [review] = await db.select({ n: count() }).from(cards).where(and(due, ne(cards.state, State.New)));
  const [fresh] = await db.select({ n: count() }).from(cards).where(and(due, eq(cards.state, State.New)));
  const dueNew = fresh?.n ?? 0;
  const { left } = await newPortion(db, userId, now);
  if (left === null) return { review: review?.n ?? 0, fresh: dueNew, waiting: 0 };
  return { review: review?.n ?? 0, fresh: Math.min(dueNew, left), waiting: Math.max(0, dueNew - left) };
}

export async function getDueItemByCard(db: Db, userId: number, cardId: number): Promise<DueItem | undefined> {
  const [row] = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return row;
}

/** Карточка до ответа — в запись ответа, чтобы его можно было отменить (undoAnswer). */
const snapshotOf = (card: CardRow) =>
  JSON.stringify({ due: card.due.getTime(), state: card.state, reps: card.reps, stability: card.stability, fsrs: card.fsrs });

/**
 * Урон ответа. Глобальный рубильник `BOSS_ENABLED` сюда НЕ передаётся намеренно.
 *
 * Он управляет только показом режима (вкладка, /boss, строка под «Готово»). Числа при его выключении
 * обязаны остаться прежними — это обещание ранбука, и на нём держится возможность снять игру без
 * последствий. Раньше флаг просачивался сюда и гасил бонусы (реликвии, серия дней) и флаг `banked`:
 * ответ того же человека давал 21 HP при включённом режиме и 20 при выключенном, а недельный прогресс
 * от выключения удваивался (E7). Личная настройка `modeBoss` остаётся: она про выбор человека.
 */
async function reviewDamage(db: Db, userId: number, roomId: number | null | undefined, answer: Answer, now: Date, cardId: number, stage?: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const active = user?.modeBoss === true;
  const skill = damageSkill(stage);
  // Комната нужна и для недели (пояс комнаты), и для бонуса Дракона — читаем один раз.
  const room = active && roomId != null ? await getRoom(db, roomId) : undefined;
  const week = active && skill && room ? latestDigestMoment(now, roomTimeZone(room)) : undefined;
  const [weeks, claims, streak] = await Promise.all([
    active ? mobHuntWeeks(db, userId) : 0,
    week ? mobClaims(db, userId, week.date) : [],
    active ? streakBuff(db, user, now, true) : undefined,
  ]);
  const bonus = claims.some((claim) => MOBS.some((mob) => mob.id === claim.target && mob.skill === skill));
  const listen = (user?.upgradeListen ?? 0) + Number(bonus && skill === "listen");
  const writing = (user?.upgradeWriting ?? 0) + Number(bonus && skill === "writing");
  const relicPercent = HUNTER_RELICS
    .filter((relic) => weeks >= relic.weeks && (relic.skill === "all" || relic.skill === skill))
    .reduce((sum, relic) => sum + relic.percent, 0);
  // 🐉 Дракон усиливает диктанты, пока он в ярости. Фаза — про ТЕКУЩЕГО босса: с ладдером боёв за неделю
  // несколько, и «ярость» наступает у каждого своя, поэтому бонус доступен в каждом раунде, а не только
  // в первом. Противник берётся первого раунда недели — механика Дракона принадлежит неделе.
  let dragonBonus = 0;
  if (skill === "listen" && week && room) {
    if (weeklyOpponent(week.at).id === "dragon" && (await bossOf(db, room, now)).phase === "furious") dragonBonus = 20;
  }
  // Затухание за серию «Забыл»: без него FSRS отдаёт карточку через минуту, и она кормит босса вечно.
  const again = answer === "again" ? await againStreak(db, cardId, now) : 1;
  return {
    damageDeci: Math.round(answerWeight(answer, stage, user?.upgradeDamage ?? 0, listen, writing, relicPercent + dragonBonus + (streak?.percent ?? 0), again) * 10),
    // `banked` — личная настройка «Копить урон» у того, кто играет. Рубильник сюда не входит (см. выше):
    // иначе выключение режима сбрасывало флаг в false, и весь накопленный запас разом попадал в /goal.
    banked: active && user.bankDamage,
  };
}

type RecordAnswerInput = { userId: number; cardId: number; expectedReps: number; answer: Answer; now: Date; stage?: string };
type RecordedAnswer = { result: "ok" | "stale"; damage: number };

export function recordAnswer(db: Db, input: RecordAnswerInput): Promise<RecordedAnswer> {
  return withCombatLock(db, () => saveAnswer(db, input));
}

async function saveAnswer(db: Db, input: RecordAnswerInput): Promise<RecordedAnswer> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)));
  if (!card || card.reps !== input.expectedReps) return { result: "stale", damage: 0 };
  const [word] = await db.select({ usefulness: words.usefulness, roomId: words.roomId }).from(words).where(eq(words.id, card.wordId));
  const damage = await reviewDamage(db, card.userId, word?.roomId, input.answer, input.now, card.id, input.stage);
  // Условное обновление «если reps всё ещё прежний»: два почти одновременных ответа (кнопка и текст)
  // не засчитаются дважды — второй увидит, что карточку уже обновили.
  const [updated] = await db
    .update(cards)
    .set(review(card.fsrs, input.answer, input.now, word?.usefulness ?? null))
    .where(and(eq(cards.id, card.id), eq(cards.reps, input.expectedReps)))
    .returning({ id: cards.id });
  if (!updated) return { result: "stale", damage: 0 };
  await db.insert(reviewLogs).values({
    userId: card.userId,
    cardId: card.id,
    rating: input.answer,
    ...damage,
    stage: input.stage ?? null,
    reviewedAt: input.now,
    before: snapshotOf(card),
  });
  return { result: "ok", damage: damage.damageDeci / 10 };
}

export async function answerCard(db: Db, input: Parameters<typeof recordAnswer>[1]): Promise<"ok" | "stale"> {
  return (await recordAnswer(db, input)).result;
}

/**
 * «↩️ Отменить»: последний ответ этого человека по карточке — карточка как была до него, запись ответа удаляется.
 * Только если после него карточку больше не оценивали (иначе отмена перепутала бы историю). undefined — нечего отменять.
 */
export async function undoAnswer(db: Db, input: { userId: number; cardId: number }): Promise<{ rating: Answer } | undefined> {
  return withCombatLock(db, () => undoRecordedAnswer(db, input));
}

async function undoRecordedAnswer(db: Db, input: { userId: number; cardId: number }) {
  const [log] = await db
    .select()
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, input.userId), eq(reviewLogs.cardId, input.cardId)))
    .orderBy(desc(reviewLogs.id))
    .limit(1);
  if (!log?.before) return undefined;
  if (log.banked && (await damageBalanceDeci(db, input.userId)) < (log.damageDeci ?? 0)) return undefined;
  const before = JSON.parse(log.before) as { due: number; state: number; reps: number; stability: number; fsrs: string };
  const [restored] = await db
    .update(cards)
    .set({ due: new Date(before.due), state: before.state, reps: before.reps, stability: before.stability, fsrs: before.fsrs })
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId), eq(cards.reps, before.reps + 1), notExists(
      db.select({ id: combatArchive.reviewId }).from(combatArchive).where(eq(combatArchive.reviewId, log.id)),
    )))
    .returning({ id: cards.id });
  if (!restored) return undefined;
  await db.delete(reviewLogs).where(eq(reviewLogs.id, log.id));
  return { rating: log.rating as Answer };
}

export async function markKnown(
  db: Db,
  input: { userId: number; wordId: number; now: Date },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.wordId, input.wordId), eq(cards.userId, input.userId)));
  if (!card || card.state !== State.New || card.reps !== 0) return "stale";
  return answerCard(db, {
    userId: input.userId, cardId: card.id, expectedReps: 0, answer: "easy", now: input.now, stage: KNOW_STAGE,
  });
}

export async function nextReviewAt(db: Db, userId: number): Promise<Date | undefined> {
  const [row] = await db
    .select({ due: cards.due })
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(asc(cards.due))
    .limit(1);
  return row?.due;
}
