import { describe, expect, it } from "vitest";
import { isTimeZone, localMoment, localParts, offsetMinutes, parseHHMM, previousDate } from "../src/time";

describe("time", () => {
  it("returns local date and time in the given zone", () => {
    expect(localParts("Europe/Moscow", new Date("2026-10-15T21:30:00Z"))).toEqual({ date: "2026-10-16", time: "00:30" });
    expect(localParts("UTC", new Date("2026-10-15T09:05:00Z"))).toEqual({ date: "2026-10-15", time: "09:05" });
  });

  it("parses HH:MM", () => {
    expect(parseHHMM("9:05")).toBe("09:05");
    expect(parseHHMM(" 21:30 ")).toBe("21:30");
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
  });

  it("computes previous date across month boundary", () => {
    expect(previousDate("2026-03-01")).toBe("2026-02-28");
    expect(previousDate("2026-10-15")).toBe("2026-10-14");
  });
});

// Пояс комнаты — не константа «+07:00»: Москва и Новосибирск смещение не меняют, а Лондон и Нью-Йорк
// меняют, и зашитое смещение дало бы сдвиг на час полгода.
describe("time zones", () => {
  it("knows the offset of a zone, including daylight saving", () => {
    expect(offsetMinutes("Asia/Novosibirsk", new Date("2026-11-22T00:00:00Z"))).toBe(7 * 60);
    expect(offsetMinutes("Europe/Moscow", new Date("2026-11-22T00:00:00Z"))).toBe(3 * 60);
    // Лондон: летом BST (+1), зимой GMT (0).
    expect(offsetMinutes("Europe/London", new Date("2026-07-19T12:00:00Z"))).toBe(60);
    expect(offsetMinutes("Europe/London", new Date("2026-11-22T12:00:00Z"))).toBe(0);
    // Нью-Йорк: летом EDT (−4), зимой EST (−5) — со знаком.
    expect(offsetMinutes("America/New_York", new Date("2026-07-19T12:00:00Z"))).toBe(-4 * 60);
    expect(offsetMinutes("America/New_York", new Date("2026-11-22T12:00:00Z"))).toBe(-5 * 60);
    expect(offsetMinutes("UTC", new Date("2026-11-22T12:00:00Z"))).toBe(0);
  });

  it("turns local wall time into a UTC moment in the right zone", () => {
    // Одно и то же «20:00» — разный UTC в разных поясах. Это и есть суть: у каждой комнаты свой конец недели.
    expect(localMoment("Asia/Novosibirsk", "2026-11-22", "20:00").toISOString()).toBe("2026-11-22T13:00:00.000Z");
    expect(localMoment("Europe/Moscow", "2026-11-22", "20:00").toISOString()).toBe("2026-11-22T17:00:00.000Z");
    expect(localMoment("UTC", "2026-11-22", "20:00").toISOString()).toBe("2026-11-22T20:00:00.000Z");
  });

  it("uses the offset in effect on the target date, not today", () => {
    // Летом в Лондоне 20:00 — это 19:00 UTC, зимой — 20:00 UTC. Один и тот же вызов, разные ответы.
    expect(localMoment("Europe/London", "2026-07-19", "20:00").toISOString()).toBe("2026-07-19T19:00:00.000Z");
    expect(localMoment("Europe/London", "2026-11-22", "20:00").toISOString()).toBe("2026-11-22T20:00:00.000Z");
    expect(localMoment("America/New_York", "2026-07-19", "20:00").toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(localMoment("America/New_York", "2026-11-22", "20:00").toISOString()).toBe("2026-11-23T01:00:00.000Z");
  });

  it("accepts only real IANA zones", () => {
    expect(isTimeZone("Europe/Moscow")).toBe(true);
    expect(isTimeZone("Asia/Novosibirsk")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Nowhere/Bad")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("+07:00")).toBe(false);
  });
});
