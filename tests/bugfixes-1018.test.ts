import { describe, expect, it, vi } from "vitest";
import { ExerciseStore, type PendingExercise } from "../src/bot/exercises";
import { storedCollocations, validQuiz } from "../src/services/collocations";
import { dbExercisePersistence } from "../src/services/pending-exercises";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

const MIN = 60_000;
const sentence: PendingExercise = { kind: "sentence", cardId: 1, reps: 3, wordId: 1, term: "beset by", chatId: 100 };

describe("an answer to an exercise is not taken for a new word", () => {
  it("waits for the answer for hours, not 15 minutes", () => {
    let now = 0;
    const store = new ExerciseStore(undefined, () => now);
    store.set(1, sentence);
    now = 37 * MIN; // Николай ответил через 37 минут
    expect(store.get(1)).toMatchObject({ kind: "sentence", term: "beset by" });
    now = 13 * 60 * MIN;
    expect(store.get(1)).toBeUndefined();
  });

  it("survives a bot restart", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const before = new ExerciseStore(dbExercisePersistence(db));
    before.set(user.id, { ...sentence, chatId: 100 });
    await vi.waitFor(async () => {
      const after = new ExerciseStore(dbExercisePersistence(db));
      await after.load();
      expect(after.get(user.id)).toMatchObject({ kind: "sentence" });
    });
    before.delete(user.id);
    await vi.waitFor(async () => {
      const after = new ExerciseStore(dbExercisePersistence(db));
      await after.load();
      expect(after.get(user.id)).toBeUndefined();
    });
  });

  it("a word draft says plainly that it adds a word", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "serendipity"));
    await vi.waitFor(() => expect(h.calls.some((c) => String(c.payload.text).startsWith("➕ <b>Добавить новое слово?</b>"))).toBe(true));
  });
});

describe("a collocation quiz never gives the answer away", () => {
  const quiz = (options: string[], correct = 0) => ({ question: "The lawyers will ___ up a contract.", options, correct, explanation: "" });

  it("rejects a gap filled by the word itself or its part", () => {
    expect(validQuiz(quiz(["draw", "do", "make"]), "draw up")).toBe(false);
    expect(validQuiz(quiz(["prudently", "prudent"], 1), "prudent")).toBe(false);
    expect(validQuiz(quiz(["gain", "take", "do"]), "foothold")).toBe(true);
  });

  it("drops such a quiz from words saved earlier but keeps the collocations", () => {
    const saved = JSON.stringify({ items: [{ phrase: "draw up a plan", translation: "составить план" }], quiz: quiz(["draw", "do", "make"]) });
    expect(storedCollocations({ term: "draw up", collocations: saved })).toEqual({ items: [{ phrase: "draw up a plan", translation: "составить план" }] });
  });
});
