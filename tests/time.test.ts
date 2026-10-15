import { describe, expect, it } from "vitest";
import { localParts, parseHHMM, previousDate } from "../src/time";

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
