import type { Db } from "../db/client";
import { reviewLogs, users } from "../db/schema";

/**
 * «Источник → сколько пришло → сколько вернулось». Сводка для админа: без неё любой канал
 * (inline, чужой чат, страница набора) даёт трафик, про который нельзя сказать ничего.
 *
 * Считается в JS, а не в SQL: в проекте запрещён SQL `LIKE`, а «седьмой день» — вычисляемое значение,
 * которое переносимо ни в `GROUP BY`, ни в `WHERE` не выносится. Людей пока десятки, не миллионы.
 */

const DAY_MS = 24 * 60 * 60_000;

/** Сколько ждём до «вернулся»: неделя — тот же срок, что и в критерии успеха (`docs/product-plan.md`, «Как понять, что канал сработал»). */
export const RETURN_DAYS = 7;

export interface SourceRow {
  source: string;
  /** Сколько человек пришло из этого источника. */
  arrived: number;
  /**
   * Сколько из них дожило до порога: у человека прошло `RETURN_DAYS` дней с прихода **и** есть хоть один
   * ответ в `review_logs` на седьмой день или позже. null — с прихода прошло меньше недели, судить рано.
   */
  returned: number | null;
}

export async function sourceSummary(db: Db, now: Date): Promise<SourceRow[]> {
  const all = await db.select().from(users);
  const logs = await db.select({ userId: reviewLogs.userId, reviewedAt: reviewLogs.reviewedAt }).from(reviewLogs);

  const byUser = new Map<number, number[]>();
  for (const log of logs) {
    const at = log.reviewedAt instanceof Date ? log.reviewedAt.getTime() : Number(log.reviewedAt);
    const list = byUser.get(log.userId);
    if (list) list.push(at);
    else byUser.set(log.userId, [at]);
  }

  const rows = new Map<string, { arrived: number; returned: number; ready: boolean }>();
  for (const user of all) {
    const source = user.source ?? "неизвестно";
    const row = rows.get(source) ?? { arrived: 0, returned: 0, ready: false };
    row.arrived++;
    // Точка отсчёта — когда источник записан. У старых людей (null) её нет: судить о них нечем.
    const since = user.sourceAt ? (user.sourceAt instanceof Date ? user.sourceAt.getTime() : Number(user.sourceAt)) : null;
    if (since != null) {
      const threshold = since + RETURN_DAYS * DAY_MS;
      if (now.getTime() >= threshold) {
        row.ready = true;
        if ((byUser.get(user.id) ?? []).some((t) => t >= threshold)) row.returned++;
      }
    }
    rows.set(source, row);
  }

  return [...rows.entries()]
    .map(([source, r]) => ({ source, arrived: r.arrived, returned: r.ready ? r.returned : null }))
    // Большие источники — вперёд; при равенстве — по алфавиту, чтобы вывод не прыгал между вызовами.
    .sort((a, b) => b.arrived - a.arrived || a.source.localeCompare(b.source));
}

/** Строки для `/status`. Пусто — источников ещё нет (все пришли до появления колонки). */
export function sourceLines(rows: SourceRow[]): string[] {
  const known = rows.filter((r) => r.source !== "неизвестно");
  if (known.length === 0) return ["Пока никто не пришёл по ссылке — источники появятся с новыми людьми."];
  return known.map((r) => {
    const back = r.returned == null ? `вернулись: рано (меньше ${RETURN_DAYS} дн.)` : `вернулись на ${RETURN_DAYS}-й день: ${r.returned}`;
    return `${r.source}: пришло ${r.arrived}, ${back}`;
  });
}
