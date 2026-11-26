import { describe, expect, it } from "vitest";
import { arenaImpact, bossScreen } from "../src/app/boss-screen";

/**
 * Экран вкладки босса: сервер отдаёт один флаг `enabled` и поле `boss`, а клиенту нужно различить
 * четыре состояния. Раньше он смотрел только на `boss` и при выключенном режиме рисовал «Боссу нужна
 * комната» — советовал завести комнату там, где это ничего не исправит (E9).
 */
describe("экран босса: выключенный режим отличается от отсутствия комнаты (E9)", () => {
  it("пока данных нет — загрузка", () => {
    expect(bossScreen(undefined)).toEqual({ state: "loading" });
  });

  it("режим выключен — свой экран, даже если комнаты тоже нет", () => {
    // Рубильник снят: комната не поможет, поэтому состояние проверяется ПЕРВЫМ.
    expect(bossScreen({ enabled: false })).toEqual({ state: "disabled" });
    // Даже если бы босс пришёл, выключенный режим приоритетнее: комната и бой тут ни при чём.
    expect(bossScreen({ enabled: false })).toEqual({ state: "disabled" });
  });

  it("режим включён — дальше решает наличие босса в ответе", () => {
    // Функция отвечает только за «включён ли режим»; есть ли комната и босс, решает поле `boss`,
    // которое читает компонент. Это разделение и не даёт перепутать два состояния.
    expect(bossScreen({ enabled: true })).toEqual({ state: "enabled" });
  });
});

describe("реакции арены на подтверждённые события", () => {
  const boss = { room: "Библиотека", week: "2026-11-16", round: 1, hp: 10, opponent: { id: "sentinel" as const } };

  it("показывает блок при нуле урона и различает личный удар и обновление комнаты", () => {
    expect(arenaImpact(boss, boss, 0)).toEqual({ kind: "block" });
    expect(arenaImpact(boss, { ...boss, hp: 3 }, 5)).toEqual({ kind: "hit", damage: 5, own: true });
    expect(arenaImpact(boss, { ...boss, hp: 3 })).toEqual({ kind: "hit", damage: 7, own: false });
    expect(arenaImpact(boss, { ...boss, hp: 11 })).toBeUndefined();
  });

  it("при смене раунда показывает прежнего поверженного босса, а при смене комнаты или недели не доигрывает удар", () => {
    expect(arenaImpact(boss, { ...boss, round: 2, hp: 25, opponent: { id: "dragon" } }, 10))
      .toEqual({ kind: "victory", defeated: "sentinel" });
    expect(arenaImpact(boss, { ...boss, room: "Обсерватория", hp: 3 })).toBeUndefined();
    expect(arenaImpact(boss, { ...boss, week: "2026-11-23", round: 2 })).toBeUndefined();
  });
});
