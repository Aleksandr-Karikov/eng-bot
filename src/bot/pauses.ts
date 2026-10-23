import type { NextAfter } from "./callbacks";
import type { Deps } from "./context";

/**
 * Разбор ответа в /learn ждёт «▶ Дальше»: в каком чате и с какого момента. Пока ждёт, текст в личке — не новое слово,
 * а, скорее всего, ответ не туда. Снимается кнопкой, следующим заданием или любой командой (clearPendingInputs).
 */
export interface Pause {
  chatId: number;
  at: number;
  /** Что покажет «▶ Дальше». */
  then: NextAfter;
}

const maps = new WeakMap<Deps, Map<number, Pause>>();

export const PAUSE_TTL_MS = 30 * 60_000;

export function pausesOf(deps: Deps): Map<number, Pause> {
  let map = maps.get(deps);
  if (!map) maps.set(deps, (map = new Map()));
  return map;
}

/** Разбор, который ждёт «Дальше» в этом чате; undefined — не ждёт. */
export function activePause(deps: Deps, userId: number, chatId: number): Pause | undefined {
  const p = pausesOf(deps).get(userId);
  return p && p.chatId === chatId && Date.now() - p.at < PAUSE_TTL_MS ? p : undefined;
}
