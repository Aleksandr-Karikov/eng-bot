import type { Deps } from "./context";

/**
 * Сколько бот ждёт ответ сообщением (название комнаты, исправление, перевод, ответ на «вставь по смыслу»).
 * Брошенное ожидание не должно через день перехватить обычное сообщение.
 */
export const PENDING_TTL_MS = 15 * 60_000;

export const isFresh = (since: number) => Date.now() - since < PENDING_TTL_MS;

/**
 * Одновременно ждём не больше одного ответа: новый запрос или команда сбрасывают остальные.
 * chatId — только ожидания этого чата: /check в группе не должен обрывать упражнение в личке.
 */
export function clearPendingInputs(deps: Deps, userId: number, chatId?: number): void {
  deps.roomNames.clear(userId, chatId);
  deps.edits.delete(userId, chatId);
  deps.exercises.delete(userId, chatId);
  deps.drafts.clearAwaiting(userId, chatId);
  deps.pictureWishes.clear(userId, chatId);
}

/**
 * Длинные режимы, в которых любой текст в личке — ответ: разговор /talk и тренажёр /translate.
 * Одновременно может быть только один; /learn тоже их завершает, иначе ответы на карточки ушли бы в разговор.
 */
export function endLongModes(deps: Deps, userId: number, keep?: "talk" | "translate"): void {
  if (keep !== "talk") deps.talks.end(userId);
  if (keep !== "translate") deps.translations.end(userId);
}
