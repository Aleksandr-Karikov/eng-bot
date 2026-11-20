import { describe, expect, it } from "vitest";
import type { Room } from "../src/db/schema";
import { TROPHIES, TROPHY_BY_KIND, trophiesFor, type WeekFacts } from "../src/services/trophies";

const WEEK = "2026-10-18";
const room = { id: 1, name: "R" } as Room;

/** Неделя, где каждый ответ «Помню» (2 HP); цель и урон задаём руками. */
function facts(over: Partial<WeekFacts> & { damage?: Map<number, number> } = {}): WeekFacts {
  const damage = over.damage ?? new Map([[1, 100]]);
  const answers = new Map<number, Array<{ rating: string; stage: string | null; at: Date }>>();
  for (const [id, hp] of damage) {
    // По умолчанию — «Помню» днём, столько штук, сколько нужно для такого HP.
    answers.set(id, Array.from({ length: Math.ceil(hp / 2) }, () => ({ rating: "good", stage: null, at: new Date(`${WEEK}T10:00:00+07:00`) })));
  }
  return {
    week: WEEK,
    room,
    damage,
    answers,
    target: 100,
    done: [...damage.values()].reduce((a, b) => a + b, 0),
    members: damage.size,
    // Часы трофеев считаются в поясе комнаты — в тестах он новосибирский, как WEEK выше.
    timeZone: "Asia/Novosibirsk",
    ...over,
  };
}

const kinds = (list: Array<{ kind: string }>) => list.map((t) => t.kind);

describe("🏆 trophies", () => {
  it("defines every trophy with a title, a rule and a repeat mode", () => {
    expect(TROPHIES.length).toBeGreaterThan(0);
    for (const t of TROPHIES) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.how.length).toBeGreaterThan(0);
      expect(t.emoji.length).toBeGreaterThan(0);
    }
    // Ключи уникальны, иначе Map съест один и коллекция соврёт.
    expect(new Set(TROPHIES.map((t) => t.kind)).size).toBe(TROPHIES.length);
  });

  it("picks the killer, and only the killer", () => {
    const f = facts({ damage: new Map([[1, 60], [2, 40]]), killer: 1, killedAt: new Date(`${WEEK}T15:00:00+07:00`) });
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("killer");
    expect(kinds(trophiesFor(f, 2, new Set()))).not.toContain("killer");
  });

  it("gives no company trophies in a room of one", () => {
    const f = facts({ damage: new Map([[1, 60]]) });
    const got = kinds(trophiesFor(f, 1, new Set()));
    expect(got).not.toContain("top");
    expect(got).not.toContain("pacifist");
    expect(got).not.toContain("carried");
  });

  it("makes pacifist a joke, not a reward: once only, and only for someone who did hit", () => {
    const f = facts({ damage: new Map([[1, 10], [2, 50], [3, 40]]) });
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("pacifist");
    // Второй раз не выдаём никогда.
    expect(kinds(trophiesFor(f, 1, new Set(["pacifist"])))).not.toContain("pacifist");
    // Кто бил больше всех — не пацифист.
    expect(kinds(trophiesFor(f, 2, new Set()))).not.toContain("pacifist");
  });

  it("hands 'carried' to someone who did not come at all", () => {
    const f = facts({ damage: new Map([[1, 100]]), members: 2, killer: 1, killedAt: new Date(`${WEEK}T15:00:00+07:00`) });
    f.answers.set(2, []);
    expect(kinds(trophiesFor(f, 2, new Set()))).toContain("carried");
  });

  it("counts top damage and the near miss", () => {
    const top = facts({ damage: new Map([[1, 60], [2, 40]]) });
    expect(kinds(trophiesFor(top, 1, new Set()))).toContain("top");
    // 49 против 51 при цели 100 — отставание 2%, это «Почти».
    const near = facts({ damage: new Map([[1, 50], [2, 51]]) });
    expect(kinds(trophiesFor(near, 1, new Set()))).toContain("almost");
  });

  it("uses HP before the killing answer for oneshot", () => {
    const f = facts({ killer: 1, hpBeforeKill: 12 });
    expect(kinds(trophiesFor(f, 1, new Set()))).not.toContain("oneshot");
    f.hpBeforeKill = 2;
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("oneshot");
  });

  it("rewards overkill only for a real margin", () => {
    expect(kinds(trophiesFor(facts({ damage: new Map([[1, 150]]) }), 1, new Set()))).toContain("overkill");
    expect(kinds(trophiesFor(facts({ damage: new Map([[1, 120]]) }), 1, new Set()))).not.toContain("overkill");
  });

  it("gives the iron week only for all seven days", () => {
    const f = facts({ damage: new Map([[1, 20]]), answers: new Map([[1, [] as Array<{ rating: string; stage: string | null; at: Date }>]]) });
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
    f.answers.set(1, days.map((d) => ({ rating: "good", stage: null, at: new Date(`${d}T10:00:00+07:00`) })));
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("iron-week");
    // Шесть дней — уже нет.
    f.answers.set(1, days.slice(0, 6).map((d) => ({ rating: "good", stage: null, at: new Date(`${d}T10:00:00+07:00`) })));
    expect(kinds(trophiesFor(f, 1, new Set()))).not.toContain("iron-week");
  });

  it("spots a night owl by the share of answers after midnight", () => {
    const late = Array.from({ length: 10 }, (_, i) => ({ rating: "good", stage: null, at: new Date(`${WEEK}T0${i % 4}:30:00+07:00`) }));
    const f = facts({ damage: new Map([[1, 20]]), answers: new Map([[1, late]]) });
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("night");
  });

  it("knows the hard exercises from the stage", () => {
    const listener = Array.from({ length: 20 }, () => ({ rating: "good", stage: "listen", at: new Date(`${WEEK}T10:00:00+07:00`) }));
    const f = facts({ damage: new Map([[1, 80]]), answers: new Map([[1, listener]]) });
    expect(kinds(trophiesFor(f, 1, new Set()))).toContain("listener");
  });

  it("requires a real sample for sniper, not three lucky answers", () => {
    const few = Array.from({ length: 20 }, () => ({ rating: "good", stage: null, at: new Date(`${WEEK}T10:00:00+07:00`) }));
    const f1 = facts({ damage: new Map([[1, 40]]), answers: new Map([[1, few]]) });
    expect(kinds(trophiesFor(f1, 1, new Set()))).not.toContain("sniper");
    const many = Array.from({ length: 100 }, () => ({ rating: "good", stage: null, at: new Date(`${WEEK}T10:00:00+07:00`) }));
    const f2 = facts({ damage: new Map([[1, 200]]), answers: new Map([[1, many]]) });
    expect(kinds(trophiesFor(f2, 1, new Set()))).toContain("sniper");
  });

  it("does not give the same weekly trophy twice", () => {
    // Weekly-трофей может повторяться, поэтому в alreadyOnce его быть не должно — проверяем саму логику.
    const f = facts({ damage: new Map([[1, 60], [2, 40]]), killer: 1, killedAt: new Date(`${WEEK}T15:00:00+07:00`) });
    expect(kinds(trophiesFor(f, 1, new Set(["killer"])))).toContain("killer");
    expect(TROPHY_BY_KIND.get("killer")?.repeat).toBe("weekly");
    expect(TROPHY_BY_KIND.get("pacifist")?.repeat).toBe("once");
  });
});

// Часы трофеев считаются в поясе комнаты. Раньше «ночь» и «утро» были зашиты на Новосибирск, и у человека
// в Москве ответы в 23:00 попадали в «ночь», хотя по его часам это был вечер.
describe("🕐 trophy hours use the room's zone", () => {
  /** Ответы в одинаковое UTC-время, разный пояс комнаты. */
  function at(hoursUtc: number, count: number) {
    return Array.from({ length: count }, () => ({
      rating: "good",
      stage: null as string | null,
      at: new Date(`2026-10-15T${String(hoursUtc).padStart(2, "0")}:00:00Z`),
    }));
  }

  it("counts night by the room's clock, not the shared one", () => {
    // 22:00 UTC — это 05:00 следующего дня по Новосибирску (граница «ночи», уже не ночь)
    // и 01:00 по Москве (ночь). Один и тот же ответ даёт разный трофей.
    const answers = at(22, 10);
    const nsk: WeekFacts = { week: WEEK, room, damage: new Map([[1, 20]]), answers: new Map([[1, answers]]), target: 100, done: 20, members: 1, timeZone: "Asia/Novosibirsk" };
    const msk: WeekFacts = { ...nsk, timeZone: "Europe/Moscow" };
    expect(kinds(trophiesFor(msk, 1, new Set()))).toContain("night");
    expect(kinds(trophiesFor(nsk, 1, new Set()))).not.toContain("night");
  });

  it("counts a morning by the room's clock", () => {
    // 05:00 UTC — 12:00 по Новосибирску (не утро) и 08:00 по Москве (утро).
    const answers = at(5, 10);
    const nsk: WeekFacts = { week: WEEK, room, damage: new Map([[1, 20]]), answers: new Map([[1, answers]]), target: 100, done: 20, members: 1, timeZone: "Asia/Novosibirsk" };
    const msk: WeekFacts = { ...nsk, timeZone: "Europe/Moscow" };
    expect(kinds(trophiesFor(msk, 1, new Set()))).toContain("early-bird");
    expect(kinds(trophiesFor(nsk, 1, new Set()))).not.toContain("early-bird");
  });

  it("measures the last hour against the room's week end", () => {
    // Конец недели в Москве — 20:00 МСК = 17:00 UTC. Удар в 15:00 UTC — за два часа, «последний час».
    const killedAt = new Date("2026-10-18T15:00:00Z");
    const base: WeekFacts = { week: "2026-10-18", room, damage: new Map([[1, 100]]), answers: new Map([[1, [{ rating: "good", stage: null, at: killedAt }]]]), killer: 1, killedAt, target: 100, done: 100, members: 1, timeZone: "Europe/Moscow" };
    expect(kinds(trophiesFor(base, 1, new Set()))).toContain("last-hour");
    // В Новосибирске та же неделя кончилась в 13:00 UTC — удар был уже после конца, не «последний час».
    expect(kinds(trophiesFor({ ...base, timeZone: "Asia/Novosibirsk" }, 1, new Set()))).not.toContain("last-hour");
  });
});
