import { sign } from "@telegram-apps/init-data-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/server";
import type { WordGuessRound } from "../src/app/word-guess";
import type { AppTranslation } from "../src/app/translate";
import { cards, reviewLogs, wordGuessProgress } from "../src/db/schema";
import type { WordGuess, WordGuessHistory, WordGuessReview } from "../src/llm/tutor";
import { damageBalanceDeci } from "../src/services/combat-ledger";
import type { DailyTasksState } from "../src/services/study-activities";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { at, DAY, makeUser, T0 } from "./helpers";

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
  const headers = (player: number) => ({
    authorization: `tma ${sign({ user: { id: player, first_name: "Player" } }, token, T0)}`,
    "content-type": "application/json",
  });
  const post = (path: string, body: object, player = 100) => app.request(path, {
    method: "POST", headers: headers(player), body: JSON.stringify(body),
  });
  const get = (path: string) => app.request(path, { headers: headers(100) });
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
  return { h, app, user, guess, post, get, open, move, roundOf };
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
    expect(wordDone.current?.result).toEqual({ term: "mortgage", attempts: 2, phrase: "take out a mortgage", energy: 2 });
    const summary = await roundOf(move(wordDone, "next"));
    expect(summary.current).toBeNull();
    const newRound = await open(true);
    expect(newRound.id).not.toBe(first.id);
    const improved = await roundOf(move(newRound, "clue", "A loan for buying a house."));
    expect(improved.results[0]).toMatchObject({ attempts: 1, previousAttempts: 2 });
    expect(improved.results[0]?.energy).toBeUndefined();
    expect(await damageBalanceDeci(h.db, before[0].userId)).toBe(20);
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

  it("открывает разбор после слова, принимает переход пока модель думает и кэширует результат", async () => {
    const { h, guess, post, open, move, roundOf } = await setup();
    const first = await open();
    const feedback = () => post("/api/word-guess/feedback", { id: first.id, index: 0 });
    const fix = { wrong: "buisness", right: "business", why: "В слове другое положение букв." };
    let finish!: (value: WordGuessReview) => void;
    const review = vi.fn(() => new Promise<WordGuessReview>((resolve) => { finish = resolve; }));
    h.deps.tutor.reviewWordGuess = review;
    expect((await feedback()).status).toBe(409);
    expect(review).not.toHaveBeenCalled();
    guess.mockResolvedValue({ guess: "mortgage", question: "", phrase: "" });
    const clue = "A loan a buisness takes out to buy a building.";
    const done = await roundOf(move(first, "clue", clue));
    const loading = feedback();
    await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
    expect(review).toHaveBeenCalledWith({ term: "mortgage", translation: "перевод", clues: [clue], needExample: false });
    expect((await roundOf(move(done, "next"))).current).toBeNull();
    finish({ fixes: [fix, { wrong: "made up", right: "other", why: "" }], example: "" });
    const checked = { ok: true, feedback: { fixes: [fix], hadClues: true, example: "" } };
    expect(await (await loading).json()).toEqual(checked);
    expect(await (await feedback()).json()).toEqual(checked);
    expect(review).toHaveBeenCalledOnce();
  });

  it("даёт пример после пропуска и позволяет повторить разбор с неудачным примером", async () => {
    const { h, guess, post, open, move, roundOf } = await setup();
    const first = await open();
    await roundOf(move(first, "skip"));
    const review = vi.fn()
      .mockResolvedValueOnce({ fixes: [], example: "A mortgage is a loan." })
      .mockResolvedValueOnce({ fixes: [], example: "It’s a loan you take out to buy a home." });
    h.deps.tutor.reviewWordGuess = review;
    const feedback = () => post("/api/word-guess/feedback", { id: first.id, index: 0 });
    expect((await feedback()).status).toBe(503);
    expect(await (await feedback()).json()).toMatchObject({ feedback: {
      fixes: [], hadClues: false, example: "It’s a loan you take out to buy a home.",
    } });
    expect(review).toHaveBeenCalledWith({ term: "mortgage", translation: "перевод", clues: [], needExample: true });
    expect(guess).not.toHaveBeenCalled();
  });

  it("считает дневные задания по разным результатам и выдаёт награды один раз", async () => {
    const { h, user, guess, post, get, open, move, roundOf } = await setup(["mortgage", "roof", "shield", "bank", "lamp", "chair"]);
    const state = async () => (await (await get("/api/daily-tasks")).json()) as DailyTasksState;
    const firstState = await state();
    const claim = (id: string, day = firstState.day) => post("/api/daily-tasks/claim", { id, day });
    expect(firstState.tasks.map(({ progress }) => progress)).toEqual([0, 0, 0, 0]);
    expect((await claim("cards")).status).toBe(409);
    const first = await open();
    expect((await state()).tasks[2].progress).toBe(0);
    guess.mockResolvedValueOnce({ guess: first.current!.term, question: "", phrase: "" });
    const done = await roundOf(move(first, "clue", "A very common thing."));
    await roundOf(move(first, "clue", "A very common thing."));
    const second = await roundOf(move(done, "next"));
    guess.mockResolvedValueOnce({ guess: second.current!.term, question: "", phrase: "" });
    await roundOf(move(second, "clue", "Something quite useful."));
    expect((await state()).tasks[2].progress).toBe(2);
    expect(await damageBalanceDeci(h.db, user.id)).toBe(40);

    const task = { ru: "Закрой окно.", en: "Close the window.", topic: "", word: "" };
    h.deps.tutor.translationTask = vi.fn()
      .mockResolvedValueOnce(task).mockResolvedValueOnce(task)
      .mockResolvedValueOnce({ ...task, ru: "Открой дверь.", en: "Open the door." })
      .mockResolvedValueOnce({ ...task, ru: "Погаси свет.", en: "Turn off the light." });
    h.deps.tutor.reviewTranslation = vi.fn().mockResolvedValue({
      correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "Верно.",
    });
    const translation = async (direction: string, previousId?: string) => {
      const response = await post("/api/translate", { direction, previousId });
      expect(response.status).toBe(200);
      return (await response.json() as { exercise: AppTranslation }).exercise;
    };
    const firstTranslation = await translation("en-ru");
    expect(firstTranslation).toMatchObject({ source: task.en });
    expect(firstTranslation.result).toBeUndefined();
    const submit = (id: string, answer: string) => post("/api/translate/answer", { id, answer });
    expect((await submit(firstTranslation.id, task.en)).status).toBe(400);
    expect((await submit(firstTranslation.id, task.ru)).status).toBe(200);
    expect(h.deps.tutor.reviewTranslation).toHaveBeenCalledWith({ task, direction: "en-ru", answer: task.ru });
    expect((await submit(firstTranslation.id, task.ru)).status).toBe(200);
    const duplicate = await translation("ru-en", firstTranslation.id);
    expect(duplicate.source).toBe(task.ru);
    expect((await submit(duplicate.id, task.en)).status).toBe(200);
    expect((await state()).tasks[1].progress).toBe(1);
    const another = await translation("ru-en", duplicate.id);
    await submit(another.id, "Open the door.");
    const last = await translation("ru-en", another.id);
    await submit(last.id, "Turn off the light.");
    expect((await state()).tasks[1].progress).toBe(3);

    const own = await h.db.select().from(cards);
    await h.db.insert(reviewLogs).values([...own.slice(0, 5), own[0], own[5]].map(({ id }, index) => ({
      cardId: id, userId: user.id, rating: "good", stage: index === 6 ? "know" : "app_en_ru", reviewedAt: T0,
    })));
    expect((await state()).tasks.map(({ progress }) => progress)).toEqual([5, 3, 2, 0]);
    await updateUser(h.db, user.id, { modeBoss: false });
    expect((await state()).canClaim).toBe(false);
    expect((await claim("cards")).status).toBe(409);
    await updateUser(h.db, user.id, { modeBoss: true });
    const replies = await Promise.all([claim("cards"), claim("cards"), claim("translate"), claim("explain")]);
    expect(replies.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect((await state()).tasks.map(({ claimed }) => claimed)).toEqual([true, true, true, false]);
    expect(await damageBalanceDeci(h.db, user.id)).toBe(340);

    h.setNow(at(DAY));
    expect((await claim("cards")).status).toBe(409);
    expect((await state()).tasks.map(({ progress, claimed }) => [progress, claimed])).toEqual([[0, false], [0, false], [0, false], [0, false]]);
    expect(await damageBalanceDeci(h.db, user.id)).toBe(340);
  });
});
