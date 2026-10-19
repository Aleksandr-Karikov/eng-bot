import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { newCard, review } from "../src/srs/srs";
import { DAY, T0 } from "./helpers";

describe("srs", () => {
  it("new card is due immediately", () => {
    const c = newCard(T0);
    expect(c.due.getTime()).toBe(T0.getTime());
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
  });

  it("easy on a new card pushes it days ahead", () => {
    const c = review(newCard(T0).fsrs, "easy", T0);
    expect(c.state).toBe(State.Review);
    expect(c.reps).toBe(1);
    expect(c.due.getTime() - T0.getTime()).toBeGreaterThanOrEqual(4 * DAY);
  });

  it("again on a new card brings it back within a day", () => {
    const c = review(newCard(T0).fsrs, "again", T0);
    expect(c.due.getTime() - T0.getTime()).toBeLessThan(DAY);
  });

  it("successful reviews grow the interval", () => {
    const first = review(newCard(T0).fsrs, "easy", T0);
    const firstInterval = first.due.getTime() - T0.getTime();
    const second = review(first.fsrs, "good", first.due);
    expect(second.due.getTime() - first.due.getTime()).toBeGreaterThan(firstInterval);
  });

  it("forgetting a review card shortens the interval", () => {
    const learned = review(newCard(T0).fsrs, "easy", T0);
    const lapsed = review(learned.fsrs, "again", learned.due);
    expect(lapsed.due.getTime() - learned.due.getTime()).toBeLessThan(DAY);
    expect(lapsed.state).toBe(State.Relearning);
  });
});

describe("intervals by usefulness", () => {
  it("brings useful words back sooner and lets optional ones go further", async () => {
    const { newCard, review } = await import("../src/srs/srs");
    const t0 = new Date("2026-10-01T10:00:00Z");
    const after = (usefulness: number | null) => {
      let card = newCard(t0);
      let now = t0;
      for (let i = 0; i < 4; i++) {
        card = review(card.fsrs, "good", now, usefulness);
        now = card.due;
      }
      return card.due.getTime() - t0.getTime();
    };
    const [useful, normal, optional] = [after(3), after(2), after(1)];
    expect(useful).toBeLessThan(normal);
    expect(optional).toBeGreaterThan(normal);
    expect(after(null)).toBe(normal);
  });
});
