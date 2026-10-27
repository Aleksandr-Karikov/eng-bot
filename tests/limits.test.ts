import { describe, expect, it } from "vitest";
import { testDb, makeUser, T0, at, DAY } from "./helpers";
import { BUDGETS, budgetUsed, checkAndCount, checkAndSpend, periodKey, QUOTAS, quotaUsed, spendDay } from "../src/services/limits";

const MSK = "Europe/Moscow";

describe("лимиты: период", () => {
  it("день считается по поясу человека, а не по UTC", () => {
    // 2026-10-15T09:00Z — в Москве 12:00, в Новосибирске 16:00 того же дня.
    expect(periodKey("day", MSK, T0)).toBe("2026-10-15");
    // 21:30Z — в Москве уже 00:30 следующего дня (UTC+3), а в Новосибирске (UTC+7) — 04:30.
    const late = new Date("2026-10-15T21:30:00Z");
    expect(periodKey("day", MSK, late)).toBe("2026-10-16");
    expect(periodKey("day", "Asia/Novosibirsk", late)).toBe("2026-10-16");
    // 20:00Z — в Москве ещё 23:00 пятнадцатого, а в Новосибирске уже 03:00 шестнадцатого:
    // один и тот же момент попадает в разные сутки, и лимит должен считаться по поясу человека.
    const evening = new Date("2026-10-15T20:00:00Z");
    expect(periodKey("day", MSK, evening)).toBe("2026-10-15");
    expect(periodKey("day", "Asia/Novosibirsk", evening)).toBe("2026-10-16");
  });

  it("неделя — ISO-номер, и один день не даёт двух недель", () => {
    const monday = new Date("2026-10-12T09:00:00Z");
    const sunday = new Date("2026-10-18T09:00:00Z");
    expect(periodKey("week", MSK, monday)).toBe(periodKey("week", MSK, sunday));
    // Следующий понедельник — уже другая неделя.
    expect(periodKey("week", MSK, new Date("2026-10-19T09:00:00Z"))).not.toBe(periodKey("week", MSK, monday));
  });
});

describe("лимиты: счёт и отказ", () => {
  it("считает попытки до предела и потом отказывает", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const limit = QUOTAS.inline_translate.limit;

    for (let i = 0; i < limit; i++) {
      const state = await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 });
      expect(state.allowed).toBe(true);
    }

    const denied = await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 });
    expect(denied.allowed).toBe(false);
    expect(denied.used).toBe(limit);
    expect(denied.refusal).toBe(QUOTAS.inline_translate.refusal);
  });

  it("отказ не увеличивает счётчик — иначе лимит уезжает вверх при настойчивости", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const limit = QUOTAS.inline_translate.limit;

    for (let i = 0; i < limit + 5; i++) {
      await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 });
    }

    expect(await quotaUsed(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 })).toBe(limit);
  });

  it("на следующий день лимит снова полный", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const limit = QUOTAS.inline_translate.limit;

    for (let i = 0; i < limit; i++) {
      await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 });
    }
    expect((await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 })).allowed).toBe(false);

    const tomorrow = await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: at(DAY) });
    expect(tomorrow.allowed).toBe(true);
    expect(tomorrow.used).toBe(1);
  });

  it("лимиты разных видов не смешиваются", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);

    await checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 });

    expect(await quotaUsed(db, { userId: user.id, kind: "image", timeZone: MSK, now: T0 })).toBe(0);
    expect(await quotaUsed(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 })).toBe(1);
  });

  it("люди считаются порознь", async () => {
    const db = testDb();
    const [a, b] = [await makeUser(db, 100), await makeUser(db, 200)];

    await checkAndCount(db, { userId: a.id, kind: "inline_translate", timeZone: MSK, now: T0 });
    await checkAndCount(db, { userId: a.id, kind: "inline_translate", timeZone: MSK, now: T0 });

    expect(await quotaUsed(db, { userId: a.id, kind: "inline_translate", timeZone: MSK, now: T0 })).toBe(2);
    expect(await quotaUsed(db, { userId: b.id, kind: "inline_translate", timeZone: MSK, now: T0 })).toBe(0);
  });

  it("одновременные запросы не теряют счёт: инкремент идёт в базе", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);

    // Инкремент — один UPDATE (count + 1), а не «прочитал → записал»: иначе одновременные запросы
    // затёрли бы друг друга и часть попыток пропала бы.
    await Promise.all(
      Array.from({ length: 10 }, () => checkAndCount(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 })),
    );

    expect(await quotaUsed(db, { userId: user.id, kind: "inline_translate", timeZone: MSK, now: T0 })).toBe(10);
  });
});

describe("общий потолок бота: картинки на всех", () => {
  it("считает картинки на весь бот, а не на человека", async () => {
    const db = testDb();
    const a = await makeUser(db, 100);
    const b = await makeUser(db, 200);

    // Расход общий: личный лимит от «200 человек рисуют разом» не спасает.
    await checkAndSpend(db, "image", T0);
    await checkAndSpend(db, "image", T0);

    expect(await budgetUsed(db, "image", T0)).toBe(2);
    expect(a.id).not.toBe(b.id);
  });

  it("отказывает, когда потолок выбран, и отказ счётчик не увеличивает", async () => {
    const db = testDb();
    const limit = BUDGETS.image.limit;

    for (let i = 0; i < limit; i++) {
      expect((await checkAndSpend(db, "image", T0)).allowed).toBe(true);
    }

    const denied = await checkAndSpend(db, "image", T0);
    expect(denied.allowed).toBe(false);
    expect(denied.refusal).toBe(BUDGETS.image.refusal);
    expect(await budgetUsed(db, "image", T0)).toBe(limit);
  });

  it("день считается по UTC: пояс одного человека не управляет расходом всего бота", async () => {
    // 20:00Z — в Новосибирске уже следующие сутки, а общий счётчик должен остаться тем же днём.
    const evening = new Date("2026-10-15T20:00:00Z");
    expect(spendDay(evening)).toBe("2026-10-15");
    expect(spendDay(new Date("2026-10-15T23:59:59Z"))).toBe("2026-10-15");
    expect(spendDay(new Date("2026-10-16T00:00:01Z"))).toBe("2026-10-16");

    const db = testDb();
    await checkAndSpend(db, "image", evening);
    expect(await budgetUsed(db, "image", evening)).toBe(1);
    expect(await budgetUsed(db, "image", new Date("2026-10-16T09:00:00Z"))).toBe(0);
  });

  it("одновременные запросы не теряют счёт", async () => {
    const db = testDb();
    // 40 «одновременных» нажатий в потолок 200: счёт должен стать ровно 40, без потерь.
    await Promise.all(Array.from({ length: 40 }, () => checkAndSpend(db, "image", T0)));
    expect(await budgetUsed(db, "image", T0)).toBe(40);
  });

  it("потолок общий и не сбрасывается новым человеком", async () => {
    const db = testDb();
    for (let i = 0; i < BUDGETS.image.limit; i++) await checkAndSpend(db, "image", T0);
    // Новый пользователь не получает свежий общий счётчик — иначе потолок обходился бы регистрацией.
    const user = await makeUser(db, 300);
    expect((await checkAndSpend(db, "image", T0)).allowed).toBe(false);
    expect(user.id).toBeGreaterThan(0);
  });
});
