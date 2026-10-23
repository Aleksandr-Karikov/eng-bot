import type { Deps } from "./context";

/**
 * Разбор ответа в /learn ждёт «▶ Дальше»: в каком чате и с какого момента. Пока ждёт, текст в личке — не новое слово,
 * а, скорее всего, ответ не туда. Снимается кнопкой, следующим заданием или любой командой (clearPendingInputs).
 */
const maps = new WeakMap<Deps, Map<number, { chatId: number; at: number }>>();

export const PAUSE_TTL_MS = 30 * 60_000;

export function pausesOf(deps: Deps): Map<number, { chatId: number; at: number }> {
  let map = maps.get(deps);
  if (!map) maps.set(deps, (map = new Map()));
  return map;
}

/** Ждёт ли разбор «Дальше» в этом чате. */
export function isPaused(deps: Deps, userId: number, chatId: number): boolean {
  const p = pausesOf(deps).get(userId);
  return Boolean(p && p.chatId === chatId && Date.now() - p.at < PAUSE_TTL_MS);
}
