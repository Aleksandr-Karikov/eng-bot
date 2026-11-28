import { sign } from "@telegram-apps/init-data-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/server";
import type { WordGuessRound } from "../src/app/word-guess";
import { cards, reviewLogs, wordGuessProgress } from "../src/db/schema";
import type { WordGuess, WordGuessHistory } from "../src/llm/tutor";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { makeUser, T0 } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

async function setup(terms = ["mortgage"]) {
  const h = botHarness();
  const guess = vi.fn<(clue: string, history: WordGuessHistory) => Promise<WordGuess>>();
  h.deps.tutor.guessWord = guess;
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of terms) {
    await saveWord(h.db, {
      roomId: room.id, addedBy: user.id, now: T0,
      draft: { term, translation: "перевод", explanation: "", example: `An example with ${term}.` },
    });
  }
  await makeUser(h.db, 200);
  const token = "123:test-token";
  const app = createApp({ deps: h.deps, botToken: token });
  const post = (path: string, body: object, player = 100) => app.request(path, {
    method: "POST", headers: {
      authorization: `tma ${sign({ user: { id: player, first_name: "Player" } }, token, T0)}`,
      "content-type": "application/json",
    }, body: JSON.stringify(body),
  });
  const roundOf = async (request: Response | Promise<Response>): Promise<WordGuessRound> => {
    const response = await request;
    expect(response.status).toBe(200);
    const result = await response.json() as { round: WordGuessRound | null };
    expect(result.round).not.toBeNull();
    return result.round!;
  };
  const open = (fresh = false) => roundOf(post("/api/word-guess", { fresh }));
  const move = ({ id, revision }: WordGuessRound, action: string, clue?: string, player?: number) =>
    post("/api/word-guess/move", { id, revision, action, clue }, player);
  return { h, app, guess, post, open, move, roundOf };
}

describe("игра «Объясни слово»", () => {
  it("ИИ угадывает вслепую, уточнение и повторный раунд сохраняют личный результат", async () => {
    const { h, app, guess, post, open, move, roundOf } = await setup();
    const before = await h.db.select().from(cards);
    expect((await app.request("/api/word-guess", { method: "POST" })).status).toBe(401);
    expect(await (await post("/api/word-guess", {}, 200)).json()).toEqual({ ok: true, round: null });

    const first = await open();
    expect(first).toMatchObject({ total: 1, current: { term: "mortgage" } });
    expect((await move(first, "clue", "Money for a home.", 200)).status).toBe(410);
    expect((await move(first, "clue", "People need mortgages.")).status).toBe(400);
    expect((await move(first, "clue", "Деньги на квартиру.")).status).toBe(400);
    expect(guess).not.toHaveBeenCalled();

    guess.mockResolvedValueOnce({ guess: "loan", question: "What is it for?", phrase: "" })
      .mockResolvedValueOnce({ guess: "A mortgage!", question: "", phrase: "take out a mortgage" })
      .mockResolvedValueOnce({ guess: "mortgage", question: "", phrase: "" });
    const clue = "You borrow money from a bank.";
    const second = await roundOf(move(first, "clue", clue));
    expect(second.current?.turns.at(-1)).toEqual({ clue, guess: "loan", question: "What is it for?" });
    expect(await roundOf(move(first, "clue", clue))).toEqual(second);
    expect(await open()).toEqual(second);

    const lastClue = "To buy a house.";
    const wordDone = await roundOf(move(second, "clue", lastClue));
    expect(guess.mock.calls).toEqual([[clue, []], [lastClue, second.current?.turns]]);
    expect(wordDone.current?.result).toEqual({ term: "mortgage", attempts: 2, phrase: "take out a mortgage" });
    const summary = await roundOf(move(wordDone, "next"));
    expect(summary.current).toBeNull();
    const newRound = await open(true);
    expect(newRound.id).not.toBe(first.id);
    const improved = await roundOf(move(newRound, "clue", "A loan for buying a house."));
    expect(improved.results[0]).toMatchObject({ attempts: 1, previousAttempts: 2 });
    expect((await h.db.select().from(wordGuessProgress))[0]).toMatchObject({ attempts: 1 });
    expect(await h.db.select().from(reviewLogs)).toEqual([]);
    expect(await h.db.select().from(cards)).toEqual(before);
  });

  it("ограничивает раунд и число подсказок, пропускает слова и даёт повторить ход после сбоя", async () => {
    const { h, guess, open, move, roundOf } = await setup(["mortgage", "bank", "roof", "shield"]);
    const first = await open();
    expect(first.total).toBe(3);
    expect(first.attemptLimit).toBe(3);
    const clue = "Something useful.";
    guess.mockRejectedValueOnce(new Error("provider failed"))
      .mockResolvedValue({ guess: "something", question: "What is it for?", phrase: "" });
    expect((await move(first, "clue", clue)).status).toBe(503);
    expect(await open()).toEqual(first);
    let round = first;
    for (let index = 0; index < first.attemptLimit; index++) {
      round = await roundOf(move(round, "clue", clue));
    }
    expect(round.current?.result?.attempts).toBeNull();
    expect((await move(round, "clue", clue)).status).toBe(409);
    for (let index = 1; index < first.total; index++) {
      round = await roundOf(move(round, "next"));
      round = await roundOf(move(round, "skip"));
    }
    expect((await roundOf(move(round, "next"))).current).toBeNull();
    expect(guess).toHaveBeenCalledTimes(4);
    expect(await h.db.select().from(wordGuessProgress)).toHaveLength(3);
  });
});
