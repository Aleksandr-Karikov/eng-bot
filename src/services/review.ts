import { HUNTER_RELICS, MOBS } from "../combat-mobs";
import { KNOW_STAGE, answerWeight, againStreak, damageSkill } from "./goals";
import { damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment, roomTimeZone } from "./digest";
import { bossOf, weeklyOpponent } from "./boss";
import { getRoom } from "./rooms";
import { streakBuff } from "./streak-buff";
import { and, asc, eq, gte, isNull, lt, lte, ne, notExists, or, desc, count, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, combatArchive, reviewLogs, words, users, type CardRow, type Word } from "../db/schema";
import { localMoment, localParts, nextDate } from "../time";
import { DEFAULT_TIMEZONE } from "./users";
import { review, type Answer } from "../srs/srs";
import { isLearned } from "./stats";
import { learningSelection, reviewableCards } from "./learning";

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
 * Дневная порция действует при первом знакомстве. Состав повторений задаёт подборка.
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
 * Убирает из очереди новые сверх доступных мест. Повторения проходят все.
 * Порядок не меняется: очередь уже отсортирована `compareQueue`, и знакомство идёт по полезности.
 */
function withinPortion(items: DueItem[], left: number): DueItem[] {
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
  const returningFirst = Number(b.card.relearningAtLimit !== null) - Number(a.card.relearningAtLimit !== null);
  if (returningFirst) return returningFirst;
  // Новые — сначала самые полезные: время на зубрёжку тратится на то, что пригодится.
  if (aNew) return b.card.learningPriority - a.card.learningPriority || (b.word.usefulness ?? 2) - (a.word.usefulness ?? 2) || a.card.createdAt.getTime() - b.card.createdAt.getTime() || a.card.id - b.card.id;
  return a.card.due.getTime() - b.card.due.getTime();
}

type LearningSelection = Awaited<ReturnType<typeof learningSelection>>;

async function dueItems(db: Db, userId: number, until: Date, selection: LearningSelection, left: number): Promise<DueItem[]> {
  const activeIds = selection.active.map(({ id }) => id);
  const reserved = selection.active.filter((card) => card.state === State.New).map(({ id }) => id);
  const slots = Math.max(0, selection.limit - selection.active.length);
  const rows = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, userId), lte(cards.due, until), or(
      reviewableCards(db, activeIds),
      left > 0 ? inArray(cards.id, reserved) : undefined,
      left > 0 && slots > 0 ? and(eq(cards.state, State.New), lte(cards.learningPriority, 0)) : undefined,
    )));
  const dueReserved = rows.filter(({ card }) => reserved.includes(card.id)).length;
  return withinPortion(rows.sort(compareQueue), Math.min(left, dueReserved + slots));
}

export async function nextDue(db: Db, userId: number, now: Date): Promise<DueItem | undefined> {
  const [item] = await dueQueue(db, userId, now, 1);
  return item;
}

/** Очередь /learn целиком (с тем же запасом «на 20 минут вперёд», что у nextDue) — для Mini App, которое грузит карточки заранее. */
export async function dueQueue(db: Db, userId: number, now: Date, limit: number): Promise<DueItem[]> {
  const [{ left }, selection] = await Promise.all([newPortion(db, userId, now), learningSelection(db, userId)]);
  const items = await dueItems(db, userId, now, selection, left ?? Infinity);
  const list = items.length ? items : await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS), selection, left ?? Infinity);
  return list.slice(0, limit);
}

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  const { review, fresh } = await countDueSplit(db, userId, now);
  return review + fresh;
}

/**
 * К повторению отдельно от новых: пачка слов друга — это знакомство, а не «40 слов ждут повторения».
 *
 * `fresh` — сколько новых можно показать с учётом дневной порции и свободных мест.
 */
export async function countDueSplit(db: Db, userId: number, now: Date) {
  const [{ left }, selection] = await Promise.all([newPortion(db, userId, now), learningSelection(db, userId)]);
  const due = and(eq(cards.userId, userId), lte(cards.due, now));
  const activeIds = selection.active.map(({ id }) => id);
  const [review] = await db.select({ n: count() }).from(cards).where(and(due, reviewableCards(db, activeIds)));
  const fresh = await db.select({ id: cards.id, priority: cards.learningPriority }).from(cards).where(and(due, eq(cards.state, State.New)));
  const slots = Math.max(0, selection.limit - selection.active.length);
  const reserved = fresh.filter(({ id }) => activeIds.includes(id)).length;
  const regular = fresh.filter(({ id, priority }) => priority <= 0 && !activeIds.includes(id)).length;
  const available = Math.min(left ?? Infinity, reserved + Math.min(slots, regular));
  return { review: review?.n ?? 0, fresh: available, waiting: fresh.length - available, activeFull: slots === 0 };
}

export async function getDueItemByCard(db: Db, userId: number, cardId: number): Promise<DueItem | undefined> {
  const [row] = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return row;
}

interface BeforeAnswer {
  due: number;
  state: number;
  reps: number;
  stability: number;
  fsrs: string;
  relearning?: { limit: number | null; priority: number; savedPriority: number };
}

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
type RecordedAnswer = { result: "ok" | "stale" | "waiting"; damage: number };

export function recordAnswer(db: Db, input: RecordAnswerInput): Promise<RecordedAnswer> {
  return withCombatLock(db, () => saveAnswer(db, input));
}

async function saveAnswer(db: Db, input: RecordAnswerInput): Promise<RecordedAnswer> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)));
  if (!card || card.reps !== input.expectedReps) return { result: "stale", damage: 0 };
  // Другой экран мог занять место или заменить эту карточку после загрузки очереди.
  const selection = input.stage !== KNOW_STAGE && (input.answer === "again" || !isLearned(card))
    ? await learningSelection(db, input.userId)
    : undefined;
  const inSelection = selection?.active.some(({ id }) => id === card.id);
  if (selection) {
    const outside = card.state === State.New && selection.active.length >= selection.limit && !inSelection;
    if (outside || selection.waiting.some(({ id }) => id === card.id)) return { result: "waiting", damage: 0 };
  }
  const [word] = await db.select({ usefulness: words.usefulness, roomId: words.roomId }).from(words).where(eq(words.id, card.wordId));
  const damage = await reviewDamage(db, card.userId, word?.roomId, input.answer, input.now, card.id, input.stage);
  const next = review(card.fsrs, input.answer, input.now, word?.usefulness ?? null);
  // После проверки выше начатое слово вне подборки может быть только знакомым.
  const returning = input.answer === "again" && card.state !== State.New && !inSelection && !isLearned(next) ? selection : undefined;
  const relearningAtLimit = returning
    ? returning.limit
    : isLearned(next) || input.stage === KNOW_STAGE ? null : card.relearningAtLimit;
  const lastActive = Math.min(...(returning?.active.map(({ priority }) => priority) ?? []));
  const firstWaiting = returning?.waiting[0]?.priority;
  const learningPriority = returning
    ? firstWaiting === undefined ? (Number.isFinite(lastActive) ? lastActive - 1 : 0) : firstWaiting + 1
    : card.learningPriority;
  const shift = Math.max(0, learningPriority - lastActive + 1);
  const before: BeforeAnswer = {
    due: card.due.getTime(), state: card.state, reps: card.reps, stability: card.stability, fsrs: card.fsrs,
    ...(relearningAtLimit !== card.relearningAtLimit
      ? { relearning: { limit: card.relearningAtLimit, priority: card.learningPriority, savedPriority: learningPriority } }
      : {}),
  };
  // Две записи — одно состояние. Раньше `UPDATE cards` и `INSERT review_logs` шли порознь: падение
  // между ними сдвигало расписание повторений, но теряло урон, ленту боя, отмену и статистику —
  // карточка «переехала», а ответа как будто не было (E28).
  //
  // Транзакция здесь СИНХРОННАЯ и намеренно: `better-sqlite3` — синхронный драйвер, его транзакция
  // не умеет ждать `async`-колбэк и молча коммитит всё, что успело выполниться. Проверено пробой:
  // `await db.transaction(async (tx) => …)` с исключением внутри оставлял и `reps = 5`, и запись
  // в `review_logs`, то есть не откатывал ничего. Поэтому внутри — только синхронные `.run()`/`.all()`,
  // а всё, что требует `await` (урон, чтение слова), посчитано до входа.
  //
  // Условное обновление «если reps всё ещё прежний» осталось: два почти одновременных ответа
  // не засчитаются дважды — второй увидит, что карточку уже обновили.
  const outcome = db.transaction((tx) => {
    const updated = tx
      .update(cards)
      .set({ ...next, relearningAtLimit, learningPriority })
      .where(and(eq(cards.id, card.id), eq(cards.reps, input.expectedReps)))
      .returning({ id: cards.id })
      .all();
    if (!updated.length) return { result: "stale" as const, damage: 0 };
    if (returning && shift > 0) {
      // Вставляем слово после активных и перед отложенными, сохраняя места текущих карточек.
      tx.update(cards).set({ learningPriority: sql`${cards.learningPriority} + ${shift}` })
        .where(inArray(cards.id, returning.active.map(({ id }) => id))).run();
    }
    tx.insert(reviewLogs)
      .values({
        userId: card.userId,
        cardId: card.id,
        rating: input.answer,
        ...damage,
        stage: input.stage ?? null,
        reviewedAt: input.now,
        before: JSON.stringify(before),
      })
      .run();
    return { result: "ok" as const, damage: damage.damageDeci / 10 };
  });
  return outcome;
}

export async function answerCard(db: Db, input: Parameters<typeof recordAnswer>[1]): Promise<RecordedAnswer["result"]> {
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
  const before = JSON.parse(log.before) as BeforeAnswer;
  const { relearning } = before;
  const [restored] = await db
    .update(cards)
    .set({
      due: new Date(before.due), state: before.state, reps: before.reps, stability: before.stability, fsrs: before.fsrs,
      ...(relearning ? {
        relearningAtLimit: relearning.limit,
        learningPriority: sql`case when ${cards.learningPriority} = ${relearning.savedPriority} then ${relearning.priority} else ${cards.learningPriority} end`,
      } : {}),
    })
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
  const result = await answerCard(db, {
    userId: input.userId, cardId: card.id, expectedReps: 0, answer: "easy", now: input.now, stage: KNOW_STAGE,
  });
  return result === "ok" ? "ok" : "stale";
}

export async function nextReviewAt(db: Db, userId: number): Promise<Date | undefined> {
  const { active } = await learningSelection(db, userId);
  const [row] = await db
    .select({ due: cards.due })
    .from(cards)
    .where(and(eq(cards.userId, userId), reviewableCards(db, active.map(({ id }) => id))))
    .orderBy(asc(cards.due))
    .limit(1);
  return row?.due;
}
