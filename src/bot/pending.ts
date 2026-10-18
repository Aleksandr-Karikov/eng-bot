import type { Deps } from "./context";

/**
 * Сколько бот ждёт ответ сообщением (название комнаты, исправление, перевод, ответ на «вставь по смыслу»).
 * Брошенное ожидание не должно через день перехватить обычное сообщение.
 */
export const PENDING_TTL_MS = 15 * 60_000;

export const isFresh = (since: number) => Date.now() - since < PENDING_TTL_MS;

/** Одновременно ждём не больше одного ответа: новый запрос или любая команда сбрасывают остальные. */
export function clearPendingInputs(deps: Deps, userId: number): void {
  deps.roomNames.clear(userId);
  deps.edits.delete(userId);
  deps.exercises.delete(userId);
  deps.drafts.clearAwaiting(userId);
  deps.pictureWishes.clear(userId);
}
