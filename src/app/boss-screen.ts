import type { BossId } from "../boss-opponents";

/**
 * Какой экран показать на вкладке босса.
 *
 * Решение вынесено из компонента в чистую функцию, потому что `app/src` не покрыт тестами (это записано
 * в `docs/audit-2026-11-24.md` как отложенная инфраструктура), а различать состояния надо точно.
 * Сервер отдаёт ОДИН флаг `enabled` и поле `boss`, и по ним получаются четыре разных экрана:
 *
 * - `loading` — данных ещё нет;
 * - `disabled` — режим выключен (рубильник `BOSS_ENABLED=0` или человек снял его себе в `/settings`):
 *   комната тут ни при чём, советовать `/room` бессмысленно;
 * - `enabled` — режим включён; есть ли комната и босс, решает само поле `boss` в ответе.
 *
 * Раньше клиент смотрел только на `data.boss` и при выключенном режиме рисовал «Боссу нужна комната»
 * с советом завести комнату — то есть предлагал действие, которое ничего не исправит (E9).
 */
export type BossScreen =
  | { state: "loading" }
  | { state: "disabled" }
  | { state: "enabled" };

/** Что показать. `data` — ответ `GET /api/boss`, `undefined` — ещё грузим. */
export function bossScreen(data: { enabled: boolean } | undefined): BossScreen {
  if (!data) return { state: "loading" };
  // Выключенный режим проверяем ПЕРВЫМ: если рубильник снят, комната не поможет, и советовать её нельзя.
  return data.enabled ? { state: "enabled" } : { state: "disabled" };
}

type ArenaBoss = {
  room: string;
  week?: string;
  round?: number;
  hp: number;
  opponent?: { id: BossId };
};

export type ArenaImpact =
  | { kind: "block" }
  | { kind: "hit"; damage: number; own: boolean }
  | { kind: "victory"; defeated: BossId };

export function arenaImpact(before: ArenaBoss, after: ArenaBoss, ownDamage?: number): ArenaImpact | undefined {
  if (before.room !== after.room || before.week !== after.week) return;
  const beforeRound = before.round ?? 1;
  const afterRound = after.round ?? 1;
  if (afterRound > beforeRound) return { kind: "victory", defeated: before.opponent?.id ?? "dragon" };
  if (beforeRound !== afterRound) return;
  if (ownDamage !== undefined) return ownDamage > 0 ? { kind: "hit", damage: ownDamage, own: true } : { kind: "block" };
  if (after.hp < before.hp) return { kind: "hit", damage: before.hp - after.hp, own: false };
}
