import { describe, expect, it, vi } from "vitest";
import { parse, sign } from "@telegram-apps/init-data-node";
import { cards, mistakes, reviewLogs } from "../src/db/schema";
import { createApp } from "../src/app/server";
import type { DialogueInput, ExerciseTutor, Judgement, SentenceInput, SentenceReview } from "../src/llm/tutor";
import { saveCloze } from "../src/services/cloze";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { at, DAY, T0, makeUser } from "./helpers";

const TOKEN = "123:test-token";
const sentence = { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу реки." };

function tutor(judge: () => Promise<Judgement>, reviewSentence: () => Promise<SentenceReview>): ExerciseTutor {
  return { cloze: async () => [], judge, drill: async () => [], mnemonics: async () => [], imagePrompt: async () => "", translationTask: async () => ({ ru: "", en: "", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [], learn: [] }), talkReply: async () => "", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence };
}

/** Одна знакомая карточка bank к повторению; включён один режим. */
async function setup(only: "modeCloze" | "modeListen" | "modeSentence", t?: ExerciseTutor, cloze = sentence) {
  const h = botHarness({ tutor: t });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, {
    canDm: true, modeEnRu: false, modeRuEn: false, modeCollocation: false, modeCloze: only === "modeCloze", modeListen: only === "modeListen", modeSentence: only === "modeSentence",
  });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "the river bank", usefulness: 3 }, now: T0 });
  if (saved.status !== "saved") throw new Error("dup");
  await saveCloze(h.db, saved.word.id, [cloze], T0);
  const [fresh] = await h.db.select().from(cards);
  const state = { state: 2, stability: 5, reps: 3, due: at(-DAY) };
  await h.db.update(cards).set({ ...state, fsrs: JSON.stringify({ ...JSON.parse(fresh.fsrs), ...state, difficulty: 5, last_review: at(-5 * DAY) }) });
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}`, "content-type": "application/json" };
  const { cards: queue } = await (await app.request("/api/queue", { headers })).json();
  const check = (body: object) => app.request("/api/check", { method: "POST", headers, body: JSON.stringify({ cardId: queue[0].cardId, reps: queue[0].reps, stage: queue[0].stage, ...body }) });
  const dialogue = (body: object = {}) => app.request("/api/dialogue", { method: "POST", headers, body: JSON.stringify({ cardId: queue[0].cardId, reps: queue[0].reps, ...body }) });
  const reply = (body: object, auth = headers) => app.request("/api/dialogue/answer", { method: "POST", headers: auth, body: JSON.stringify(body) });
  const ratings = async () => (await h.db.select().from(reviewLogs)).map((l) => `${l.stage}:${l.rating}`);
  return { h, app, headers, queue, check, dialogue, reply, ratings };
}

const noJudge = async (): Promise<Judgement> => ({ correct: false, explanation: "", tip: "" });
const noReview = async (): Promise<SentenceReview> => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" });

describe("✍️ 🎧 typed answers in the app", () => {
  it("cloze: the sentence comes without the answer; exact — «Помню» at once, no model", async () => {
    const judge = vi.fn(noJudge);
    const { queue, check, ratings } = await setup("modeCloze", tutor(judge, noReview));
    expect(queue[0]).toMatchObject({ stage: "cloze", cloze: { sentence: sentence.sentence, translation: sentence.translation } });
    expect(JSON.stringify(queue[0].cloze)).not.toContain('"bank"');
    const res = await (await check({ clozeId: queue[0].cloze.id, answer: "Bank" })).json();
    expect(res).toMatchObject({ ok: true, correct: true, filled: { before: "We sat on the ", answer: "bank" } });
    expect(judge).not.toHaveBeenCalled();
    expect(await ratings()).toEqual(["app_cloze:good"]);
  });

  it("cloze: otherwise the model judges, with an explanation", async () => {
    const { queue, check, ratings } = await setup("modeCloze", tutor(async () => ({ correct: false, explanation: "Нужно существительное.", tip: "" }), noReview));
    const res = await (await check({ clozeId: queue[0].cloze.id, answer: "shore of" })).json();
    expect(res).toMatchObject({ correct: false, explanation: "Нужно существительное." });
    expect(await ratings()).toEqual(["app_cloze:again"]);
  });

  it("cloze: «Не знаю» без ввода открывает оба пропуска и ставит «Забыл» без модели", async () => {
    const judge = vi.fn(noJudge);
    const { queue, check, ratings } = await setup("modeCloze", tutor(judge, noReview), {
      sentence: "We ___ on the ___ of the river.",
      answer: "sat|bank",
      translation: sentence.translation,
    });
    const res = await (await check({ clozeId: queue[0].cloze.id, dunno: true })).json();
    expect(res).toMatchObject({ correct: false, filled: { parts: [
      { text: "We " }, { answer: "sat" }, { text: " on the " }, { answer: "bank" }, { text: " of the river." },
    ] } });
    expect(judge).not.toHaveBeenCalled();
    expect(await ratings()).toEqual(["app_cloze:again"]);
  });

  it("dictation: a typo still counts, a wrong word does not; «Не знаю» reveals", async () => {
    const { check, ratings } = await setup("modeListen");
    expect(await (await check({ answer: "bnak" })).json()).toMatchObject({ correct: false, term: "bank" });
    expect(await ratings()).toEqual(["app_listen:again"]);
  });

  it("own sentence: rated by the word's use; mistakes saved only on «Сохранить»", async () => {
    const review = async (): Promise<SentenceReview> => ({ usesWord: true, verdict: "Верно", corrected: "We **were** at the bank", fixes: [{ wrong: "was", right: "were", why: "we → were", category: "согласование", slip: false }], natural: "" });
    const { h, app, headers, check, ratings } = await setup("modeSentence", tutor(noJudge, review));
    const res = await (await check({ answer: "We was at the bank" })).json();
    expect(res).toMatchObject({ correct: true, verdict: "Верно", fixes: [{ wrong: "was" }] });
    expect(await ratings()).toEqual(["app_sentence:good"]);
    expect(await h.db.select().from(mistakes)).toEqual([]);
    await app.request("/api/mistakes", { method: "POST", headers, body: JSON.stringify({ id: res.mistakesId, save: true }) });
    expect((await h.db.select().from(mistakes)).map((m) => m.category)).toEqual(["согласование"]);
  });

  it("if the model is down, nothing is rated — the app lets you rate yourself", async () => {
    const { check, ratings } = await setup("modeSentence", tutor(noJudge, async () => { throw new Error("down"); }));
    expect(await (await check({ answer: "I sat on the bank" })).json()).toMatchObject({ ok: true, unchecked: true, term: "bank" });
    expect(await ratings()).toEqual([]);
  });
});

const riverside = { situation: "Вы с другом у реки.", line: "Where should we have lunch?", hint: "Let's sit on…" };
const followUp = { line: "Where on that side would it be quieter?", hint: "We could try…" };

describe("диалог на карточке Mini App", () => {
  it("даёт повторить реплику, оценивает её один раз, продолжает разговор и меняет цель", async () => {
    const dialogueScene = vi.fn(async (_: DialogueInput) => riverside);
    const reviewSentence = vi.fn(async (input: SentenceInput): Promise<SentenceReview> => ({
      ...(await noReview()),
      usesWord: input.answer.includes("bank"),
      verdict: "Попробуй уточнить место.",
      followUp: input.dialogue?.askAgain ? followUp : undefined,
    }));
    const { h, headers, dialogue, reply, queue, ratings } = await setup("modeSentence", { ...tutor(noJudge, noReview), dialogueScene, reviewSentence });
    const [one, two] = await Promise.all([dialogue(), dialogue()]);
    const scene = await one.json();
    expect(scene).toMatchObject(riverside);
    expect(await two.json()).toEqual(scene);
    expect(dialogueScene).toHaveBeenCalledTimes(1);

    const stranger = await makeUser(h.db, 200);
    const { auth_date: authDate } = parse(headers.authorization.slice(4));
    const auth = { ...headers, authorization: `tma ${sign({ user: { id: stranger.telegramId, first_name: "U" } }, TOKEN, authDate)}` };
    expect((await reply({ id: scene.id, turn: 1, answer: "Me too" }, auth)).status).toBe(410);
    expect((await reply({ id: scene.id, turn: 2, answer: "Too early" })).status).toBe(410);
    expect(reviewSentence).not.toHaveBeenCalled();

    const firstTry = { id: scene.id, turn: 1, answer: "Over there." };
    expect(await (await reply(firstTry)).json()).toMatchObject({ retry: true, verdict: "Попробуй уточнить место." });
    expect(await (await reply(firstTry)).json()).toMatchObject({ retry: true });
    expect(await ratings()).toEqual([]);
    expect(reviewSentence).toHaveBeenCalledTimes(1);

    const first = { id: scene.id, turn: 1, answer: "Let's sit on the river bank." };
    const result = await (await reply(first)).json();
    expect(result).toMatchObject({ correct: true, followUp });
    expect(await (await reply(first)).json()).toEqual(result);
    expect(await ratings()).toEqual(["app_sentence:good"]);

    expect(await (await reply({ id: scene.id, turn: 2, answer: "The far bank is quieter." })).json()).toMatchObject({ correct: true, damage: 0 });
    expect(reviewSentence).toHaveBeenLastCalledWith(expect.objectContaining({
      dialogue: { line: followUp.line, previous: { line: riverside.line, answer: first.answer } },
    }));
    expect(await ratings()).toEqual(["app_sentence:good"]);
    expect((await dialogue({ reps: queue[0].reps + 1 })).status).toBe(200);
    expect(dialogueScene.mock.calls[0][0].focus).not.toBe(dialogueScene.mock.calls[1][0].focus);
  });

  it("позволяет перейти к обычной карточке при отказе модели, тренирует вне зачёта", async () => {
    const dialogueScene = vi.fn<NonNullable<ExerciseTutor["dialogueScene"]>>()
      .mockRejectedValueOnce(new Error("down")).mockResolvedValue(riverside);
    const reviewSentence = vi.fn<ExerciseTutor["reviewSentence"]>()
      .mockRejectedValueOnce(new Error("down")).mockImplementation(noReview);
    const { dialogue, reply, ratings } = await setup("modeSentence", { ...tutor(noJudge, noReview), dialogueScene, reviewSentence });
    expect((await dialogue()).status).toBe(503);
    const { id } = await (await dialogue({ practice: true })).json();
    expect((await reply({ id, turn: 1, answer: "On the river bank." })).status).toBe(503);
    expect(await (await reply({ id, turn: 1, answer: "On the river bank." })).json()).toMatchObject({ correct: true, damage: 0 });
    expect(await ratings()).toEqual([]);
  });
});
