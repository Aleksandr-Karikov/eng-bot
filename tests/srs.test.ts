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
