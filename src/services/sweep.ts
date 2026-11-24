import { and, lt, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/client";
import { combatSpends, dailySpend, duelPoints, reviewLogs, usageCounters, words } from "../db/schema";

/**
 * Уборка накопившихся данных (E29).
 *
 * Правило простое: **служебное чистим, историю обучения храним**. Счётчики квот, расход на модель,
 * траты в бою, дуэльные очки — это бухгалтерия за период, она нужна только пока период актуален.
 * `review_logs` не трогаем: это история человека, по ней считаются серии, трофеи и статистика.
 *
 * Сроки названы явно и подобраны по смыслу, а не «на глазок»:
 *
 * - `usage_counters` — 30 дней. Дневные и недельные лимиты старше месяца не читает никто
 *   (`periodKey` считает текущий период, старые строки мёртвые).
 * - `daily_spend` — 30 дней. Бюджет картинок считается за сутки, история не нужна.
 * - `combat_spends` — 8 недель. На нём считаются мобы и руны текущей недели; `bossFeed` читает
 *   только текущую неделю, а `mobHuntWeeks` — сколько недель охоты было. Восемь недель с запасом
 *   покрывают любые «недавние» вопросы и при этом не дают таблице расти бесконечно.
 * - `duel_points` — 8 недель, по тем же причинам: дуэльная таблица недельная.
 * - `review_logs.before` — обнуляется у всех строк, кроме последней по карточке. Снимок нужен
 *   ровно для «↩️ Отменить» последнего ответа; у остальных строк это 294 байта мусора на запись.
 *
 * Файлы:
 * - `data/audio` — по списку текущих слов. Имя файла начинается с `wordId`, поэтому файл без слова
 *   в базе (слово удалили или переименовали) не нужен никому.
 * - `data/voice-samples` — записи для проверки распознавания, срок 30 дней: это отладочный материал.
 */

/** Сроки хранения службных таблиц. Явные числа — их видно в одном месте и легко поменять. */
export const RETENTION = {
  /** Счётчики квот: дневные и недельные лимиты старше месяца не читаются. */
  usageCountersDays: 30,
  /** Расход на модель: бюджет считается за сутки. */
  dailySpendDays: 30,
  /** Траты в бою: мобы и руны живут в пределах недели, восемь недель — запас. */
  combatSpendsDays: 56,
  /** Дуэльные очки: таблица недельная, восемь недель — запас. */
  duelPointsDays: 56,
  /** Голосовые записи: отладочный материал. */
  voiceSamplesDays: 30,
} as const;

const DAY_MS = 24 * 60 * 60_000;

export interface SweepResult {
  usageCounters: number;
  dailySpend: number;
  combatSpends: number;
  duelPoints: number;
  /** Сколько строк `review_logs` потеряли снимок `before`. */
  beforeCleared: number;
  /** Сколько файлов удалено из `data/audio` и `data/voice-samples`. */
  audioFiles: number;
  voiceFiles: number;
}

/**
 * Один проход уборки. Идемпотентен: повторный вызов на тех же данных ничего не удалит.
 *
 * `now` — параметр, а не `new Date()`, чтобы тест управлял временем: сроки проверяются
 * на границе (`ровно 30 дней` / `30 дней и час`), и без подмены времени это не проверить.
 */
export async function sweep(
  db: Db,
  input: {
    now: Date;
    /** Папка кэша озвучки; не задана — файлы не трогаем (например, в тестах без диска). */
    audioDir?: string;
    /** Папка голосовых записей; не задана — не трогаем. */
    voiceSamplesDir?: string;
  },
): Promise<SweepResult> {
  const before = (days: number) => new Date(input.now.getTime() - days * DAY_MS);
  const at = (days: number) => before(days).getTime();

  // Служебные таблицы: удаляются строки старше срока. `updatedAt` у счётчиков — время последней
  // записи, и оно же время периода: счётчик за 5 октября обновлялся 5 октября.
  const counters = await db
    .delete(usageCounters)
    .where(lt(usageCounters.updatedAt, before(RETENTION.usageCountersDays)))
    .returning({ userId: usageCounters.userId });
  // dailySpend хранит день строкой (YYYY-MM-DD) и время — чистим по времени.
  const spend = await db
    .delete(dailySpend)
    .where(lt(dailySpend.updatedAt, before(RETENTION.dailySpendDays)))
    .returning({ kind: dailySpend.kind });
  const combat = await db
    .delete(combatSpends)
    .where(lt(combatSpends.at, before(RETENTION.combatSpendsDays)))
    .returning({ id: combatSpends.id });
  const duels = await db
    .delete(duelPoints)
    .where(lt(duelPoints.createdAt, before(RETENTION.duelPointsDays)))
    .returning({ userId: duelPoints.userId });

  // Снимок `before` — только у последней строки по карточке. Чистим «всё, кроме максимума id».
  const cleared = await db
    .update(reviewLogs)
    .set({ before: null })
    .where(and(
      sql`${reviewLogs.id} NOT IN (
        SELECT MAX(r2.id) FROM review_logs r2 WHERE r2.card_id = ${reviewLogs.cardId}
      )`,
      sql`${reviewLogs.before} IS NOT NULL`,
    ))
    .returning({ id: reviewLogs.id });

  // Аудио: имя файла начинается с id слова, поэтому оставляем файлы текущих слов.
  const audioFiles = input.audioDir ? await pruneByPrefix(input.audioDir, await wordIds(db)) : 0;
  const voiceFiles = input.voiceSamplesDir ? await pruneOlderThan(input.voiceSamplesDir, at(RETENTION.voiceSamplesDays)) : 0;

  return {
    usageCounters: counters.length,
    dailySpend: spend.length,
    combatSpends: combat.length,
    duelPoints: duels.length,
    beforeCleared: cleared.length,
    audioFiles,
    voiceFiles,
  };
}

/** Все id слов в базе — по ним решается, какие файлы озвучки ещё нужны. */
async function wordIds(db: Db): Promise<Set<string>> {
  const rows = await db.select({ id: words.id }).from(words);
  return new Set(rows.map((r) => String(r.id)));
}

/**
 * Удаляет файлы, чей числовой префикс (`<id>-uk-<hash>.m4a`) не принадлежит ни одному слову.
 *
 * Именно префикс, а не точное имя: хэш зависит от термина, и при переименовании слова имя меняется —
 * старый файл осиротел бы навсегда, хотя префикс у него тот же. Поэтому файл «нужен», если его слово
 * ещё существует; перерисовка перезапишет содержимое под новым именем.
 */
async function pruneByPrefix(dir: string, keepIds: Set<string>): Promise<number> {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".m4a")) continue;
    const id = file.split("-")[0];
    if (keepIds.has(id)) continue;
    await rm(join(dir, file), { force: true });
    removed++;
  }
  return removed;
}

/** Удаляет файлы старше срока по mtime — для голосовых записей, где имя ничего не говорит. */
async function pruneOlderThan(dir: string, beforeMs: number): Promise<number> {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const file of await readdir(dir)) {
    const info = await stat(join(dir, file));
    if (info.mtimeMs >= beforeMs) continue;
    await rm(join(dir, file), { force: true });
    removed++;
  }
  return removed;
}

/** Сколько всего накопилось — для `/status` и проверки руками. Ничего не меняет. */
export async function storageReport(db: Db, audioDir?: string): Promise<{
  usageCounters: number;
  combatSpends: number;
  duelPoints: number;
  reviewLogs: number;
  withBefore: number;
  audioFiles: number;
}> {
  const [counters] = await db.select({ n: sql<number>`count(*)` }).from(usageCounters);
  const [combat] = await db.select({ n: sql<number>`count(*)` }).from(combatSpends);
  const [duels] = await db.select({ n: sql<number>`count(*)` }).from(duelPoints);
  const [logs] = await db.select({ n: sql<number>`count(*)` }).from(reviewLogs);
  const [withBefore] = await db.select({ n: sql<number>`count(*)` }).from(reviewLogs).where(sql`${reviewLogs.before} IS NOT NULL`);
  const audioFiles = audioDir && existsSync(audioDir) ? (await readdir(audioDir)).filter((f) => f.endsWith(".m4a")).length : 0;
  return {
    usageCounters: counters?.n ?? 0,
    combatSpends: combat?.n ?? 0,
    duelPoints: duels?.n ?? 0,
    reviewLogs: logs?.n ?? 0,
    withBefore: withBefore?.n ?? 0,
    audioFiles,
  };
}
