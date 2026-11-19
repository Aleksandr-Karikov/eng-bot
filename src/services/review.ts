import { HUNTER_RELICS, MOBS } from "../combat-mobs";
import { answerWeight, damageSkill } from "./goals";
import { damageBalanceDeci, mobClaims, mobHuntWeeks, withCombatLock } from "./combat-ledger";
import { latestDigestMoment } from "./digest";
import { bossOf, weeklyOpponent } from "./boss";
import { getRoom } from "./rooms";
import { streakBuff } from "./streak-buff";
import { inCurrentLanguage } from "./language";
import { and, asc, count, desc, eq, lte, ne, notExists } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, combatArchive, reviewLogs, words, users, type CardRow, type Word } from "../db/schema";
import { review, type Answer } from "../srs/srs";

export interface DueItem {
  card: CardRow;
  word: Word;
}

export const LEARN_AHEAD_MS = 20 * 60_000;

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
  const [item] = await dueItems(db, userId, now);
  if (item) return item;
  const [ahead] = await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return ahead;
}

/** Очередь /learn целиком (с тем же запасом «на 20 минут вперёд», что у nextDue) — для Mini App, которое грузит карточки заранее. */
export async function dueQueue(db: Db, userId: number, now: Date, limit: number): Promise<DueItem[]> {
  const items = await dueItems(db, userId, now);
  const list = items.length ? items : await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return list.slice(0, limit);
}

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  // Считает каждую минуту для напоминаний — без загрузки самих карточек и слов.
  const [row] = await db.select({ n: count() }).from(cards).where(and(eq(cards.userId, userId), lte(cards.due, now)));
  return row?.n ?? 0;
}

/** К повторению отдельно от новых: пачка слов друга — это знакомство, а не «40 слов ждут повторения». */
export async function countDueSplit(db: Db, userId: number, now: Date): Promise<{ review: number; fresh: number }> {
  const due = and(eq(cards.userId, userId), lte(cards.due, now));
  const [review] = await db.select({ n: count() }).from(cards).where(and(due, ne(cards.state, State.New)));
  const [fresh] = await db.select({ n: count() }).from(cards).where(and(due, eq(cards.state, State.New)));
  return { review: review?.n ?? 0, fresh: fresh?.n ?? 0 };
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

async function reviewDamage(db: Db, userId: number, roomId: number | null | undefined, answer: Answer, now: Date, stage?: string, enabled?: boolean) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const active = enabled !== false && user?.modeBoss === true;
  const skill = damageSkill(stage);
  const week = active && skill ? latestDigestMoment(now) : undefined;
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
  let dragonBonus = 0;
  if (skill === "listen" && week && roomId != null && weeklyOpponent(week.at).id === "dragon") {
    const room = await getRoom(db, roomId);
    if (room && (await bossOf(db, room, now)).phase === "furious") dragonBonus = 20;
  }
  return {
    damageDeci: Math.round(answerWeight(answer, stage, user?.upgradeDamage ?? 0, listen, writing, relicPercent + dragonBonus + (streak?.percent ?? 0)) * 10),
    banked: active && user.bankDamage,
  };
}

type RecordAnswerInput = { userId: number; cardId: number; expectedReps: number; answer: Answer; now: Date; stage?: string; bossEnabled?: boolean };
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
  const damage = await reviewDamage(db, card.userId, word?.roomId, input.answer, input.now, input.stage, input.bossEnabled);
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
  input: { userId: number; wordId: number; now: Date; bossEnabled?: boolean },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.wordId, input.wordId), eq(cards.userId, input.userId)));
  if (!card || card.state !== State.New || card.reps !== 0) return "stale";
  return answerCard(db, {
    userId: input.userId, cardId: card.id, expectedReps: 0, answer: "easy", now: input.now, stage: "know", bossEnabled: input.bossEnabled,
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
