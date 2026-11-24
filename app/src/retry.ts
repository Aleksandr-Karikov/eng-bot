/**
 * Повтор запроса, когда сервер недоступен.
 *
 * 502/503/504 от Nginx означают, что процесс бота не ответил: его перезапустил systemd после падения
 * (на VPS он падал от нехватки памяти — E36). Запрос в этот момент не дошёл, и без повтора ответ
 * человека пропадал: приложение показывало ошибку, карточка оставалась неоценённой (#24).
 *
 * Повторяем РОВНО один раз: если сервер лежит дольше, честнее показать ошибку, чем крутить запросы.
 * Зовётся только для тех запросов, которые можно повторить без последствий — оценку карточки от
 * двойного зачёта защищает сверка `reps` на сервере, а чтение побочных действий не имеет.
 */

/** Коды «сервер не ответил»: именно их отдаёт Nginx, когда за ним никого нет. */
export const RETRY_STATUSES: readonly number[] = [502, 503, 504];

/** Пауза перед повтором: сервис поднимается за секунды, ждать дольше незачем. */
export const RETRY_DELAY_MS = 700;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  delayMs?: number;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
  /** Какие ошибки повторять. По умолчанию — по коду `status`. */
  isRetryable?: (err: unknown) => boolean;
}

const statusOf = (err: unknown): number | undefined =>
  typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;

/** Выполнить `run`; если сервер не ответил — подождать и попробовать ещё раз. */
export async function retryServerDown<T>(run: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const isRetryable = opts.isRetryable ?? ((err) => RETRY_STATUSES.includes(statusOf(err) ?? 0));
  try {
    return await run();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await (opts.sleep ?? delay)(opts.delayMs ?? RETRY_DELAY_MS);
    return run();
  }
}
