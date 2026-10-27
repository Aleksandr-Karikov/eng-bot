import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { usageCounters } from "../db/schema";
import { localParts } from "../time";

/**
 * Лимиты на тяжёлые операции: сколько раз человек может сделать что-то за период.
 *
 * Зачем: на старте доступ полный, но отдельный человек не должен выесть ключ. Дороже всего картинки
 * и вызовы модели, поэтому ограничиваем их точечно, а не «всё подряд» (см. docs/limits-and-pricing.md).
 *
 * Устройство намеренно простое: одна таблица `usage_counters` с ключом (человек, период, вид), а не
 * подсчёт по существующим таблицам. Причина — **отказ тоже обязан считаться**: если не считать попытки,
 * лимит обходится повтором запроса, и злоупотребление выглядит как обычная работа.
 */

/** Что именно ограничиваем. Список закрытый: опечатка в строке иначе тихо создаст новый счётчик. */
export type QuotaKind = "inline_translate" | "image" | "image_redraw" | "add_word";

export type QuotaPeriod = "day" | "week";

export interface Quota {
  kind: QuotaKind;
  period: QuotaPeriod;
  /** Сколько раз за период можно. */
  limit: number;
  /** Что сказать человеку, когда лимит исчерпан. Коротко и по делу, без «попробуйте позже». */
  refusal: string;
}

/**
 * Квоты на время запуска. Тарифов пока нет — у всех одинаково (docs/limits-and-pricing.md).
 *
 * `inline_translate` — перевод нового слова прямо из инлайн-режима: человек написал `@бот слово`,
 * слова нет в словарях, и бот зовёт модель. Это единственный вызов модели, доступный **незнакомому**
 * человеку, поэтому лимит здесь обязателен: иначе `@бот` в чужом чате — бесплатный доступ к ключу.
 */
export const QUOTAS: Record<QuotaKind, Quota> = {
  inline_translate: {
    kind: "inline_translate",
    period: "day",
    limit: 30,
    refusal: "На сегодня хватит переводов (30). Продолжим завтра, а пока — добавь слово в словарь и повторяй его.",
  },
  image: {
    kind: "image",
    period: "day",
    limit: 10,
    refusal: "Картинок на сегодня достаточно (10). Новые будут завтра.",
  },
  image_redraw: {
    kind: "image_redraw",
    period: "day",
    limit: 3,
    refusal: "Эту картинку уже перерисовывали 3 раза. Попробуй другую — или оставь как есть.",
  },
  add_word: {
    kind: "add_word",
    period: "day",
    limit: 50,
    refusal: "Слов на сегодня достаточно (50). Сначала повтори то, что уже есть, — /learn.",
  },
};

/** Период в виде строки: день «2026-10-27» по поясу человека, неделя «2026-W43» (ISO). */
export function periodKey(period: QuotaPeriod, timeZone: string, now: Date): string {
  const { date } = localParts(timeZone, now);
  if (period === "day") return date;
  return weekKey(date);
}

/** ISO-неделя «2026-W43» из локальной даты. Считается по календарю, без Date — чтобы не зависеть от пояса. */
function weekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Четверг той же недели определяет её номер по ISO: неделя принадлежит году своего четверга.
  const thursday = new Date(Date.UTC(y, m - 1, d));
  const dayNum = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNum);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface QuotaState {
  /** Можно ли выполнить операцию. */
  allowed: boolean;
  /** Сколько уже сделано за период (до этой попытки). */
  used: number;
  limit: number;
  /** Что сказать при отказе. */
  refusal: string;
}

/** Сколько уже израсходовано — без записи. Нужно там, где важно показать остаток, а не потратить. */
export async function quotaUsed(db: Db, userId: number, kind: QuotaKind, timeZone: string, now: Date): Promise<number> {
  const quota = QUOTAS[kind];
  const period = periodKey(quota.period, timeZone, now);
  const [row] = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period), eq(usageCounters.kind, kind)));
  return row?.count ?? 0;
}

/**
 * Проверить лимит и, если можно, сразу записать попытку.
 *
 * Проверка и запись — одна операция намеренно: между «проверил» и «записал» не должно быть `await`,
 * иначе два одновременных запроса пройдут лимит вдвоём. Инкремент идёт одним UPDATE (`count + 1`),
 * поэтому гонка не теряет счётчик; в SQLite запись сериализуется базой.
 */
export async function checkAndCount(
  db: Db,
  input: { userId: number; kind: QuotaKind; timeZone: string; now: Date },
): Promise<QuotaState> {
  const quota = QUOTAS[input.kind];
  const period = periodKey(quota.period, input.timeZone, input.now);
  const key = { userId: input.userId, period, kind: input.kind };
  const used = await quotaUsed(db, input.userId, input.kind, input.timeZone, input.now);

  if (used >= quota.limit) {
    return { allowed: false, used, limit: quota.limit, refusal: quota.refusal };
  }

  // ON CONFLICT … DO UPDATE SET count = count + 1 — переносимо между SQLite и Postgres.
  await db
    .insert(usageCounters)
    .values({ ...key, count: 1, updatedAt: input.now })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period, usageCounters.kind],
      set: { count: sql`${usageCounters.count} + 1`, updatedAt: input.now },
    });

  return { allowed: true, used: used + 1, limit: quota.limit, refusal: quota.refusal };
}

/** Строка «5 из 30» — для /status и там, где человеку важно видеть остаток. */
export function quotaLine(kind: QuotaKind, used: number): string {
  const quota = QUOTAS[kind];
  const unit = quota.period === "day" ? "сегодня" : "на этой неделе";
  return `${kind}: ${used} из ${quota.limit} ${unit}`;
}
