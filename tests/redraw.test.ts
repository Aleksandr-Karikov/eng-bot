import { describe, expect, it, vi } from "vitest";
import type { ExerciseTutor } from "../src/llm/tutor";
import { buildImagePromptPrompt } from "../src/llm/tutor";
import { STYLE_PRESETS } from "../src/images/images";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, setImageFileId } from "../src/services/words";
import { QUOTAS, quotaUsed } from "../src/services/limits";
import { users } from "../src/db/schema";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { at, DAY, T0, makeUser } from "./helpers";

function setup(withImages = true) {
  const imagePrompt = vi.fn(async () => "an old family house");
  const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], translationTask: async () => ({ ru: "Привет", en: "Hi", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt };
  const draw = vi.fn(async () => Buffer.from("png"));
  const h = botHarness({ tutor, images: withImages ? { draw } : undefined });
  return { h, draw, imagePrompt };
}

async function word(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "heritage", translation: "наследие", explanation: "", example: "" }, now: T0 });
  if (r.status !== "saved") throw new Error("dup");
  await setImageFileId(h.db, r.word.id, "old-pic");
  return r.word;
}

const fileId = async (h: ReturnType<typeof botHarness>, id: number) => (await getWord(h.db, id))?.imageFileId;

describe("🔄 redraw a picture", () => {
  it("is offered under a picture and on a /learn picture card", async () => {
    const { h } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `im:${w.id}`));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("🔄 Перерисовать");
    await h.bot.handleUpdate(h.message(100, "/learn"));
    await h.bot.handleUpdate(h.manage(100));
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("🔄 Перерисовать");
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🖼 Картинка");
  });

  it("offers another take, the six styles and a custom description", async () => {
    const { h } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    const labels = lastButtons(h.calls).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["🎲 Ещё вариант", "✍️ Свой вариант", ...STYLE_PRESETS.map((s) => `🎨 ${s.label}`)]));
  });

  it("🎲 draws a new take and replaces the room's picture", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎲 Ещё вариант")));
    await vi.waitFor(async () => expect(await fileId(h, w.id)).toMatch(/^photo-file-/));
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("🎨 redraws in the chosen style", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, `🎨 ${STYLE_PRESETS[1].label}`)));
    await vi.waitFor(() => expect(draw).toHaveBeenCalled());
    expect(draw).toHaveBeenCalledWith(`an old family house, ${STYLE_PRESETS[1].style}`);
  });

  it("✍️ takes a description in any words and draws it", async () => {
    const { h, draw, imagePrompt } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✍️ Свой вариант")));
    expect(h.calls.some((c) => String(c.payload.text).includes("Опиши картинку"))).toBe(true);
    await h.bot.handleUpdate(h.message(100, "бабушкин сундук со старыми фотографиями"));
    await vi.waitFor(() => expect(draw).toHaveBeenCalled());
    expect(imagePrompt).toHaveBeenCalledWith(expect.objectContaining({ term: "heritage", wish: "бабушкин сундук со старыми фотографиями" }));
    await vi.waitFor(async () => expect(await fileId(h, w.id)).toMatch(/^photo-file-/));
    expect(buildImagePromptPrompt({ term: "heritage", translation: "наследие", explanation: "", example: "", wish: "сундук" })).toContain("сундук");
  });

  it("refuses when pictures are off", async () => {
    const { h } = setup(false);
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    expect(String(h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload.text)).toContain("выключены");
  });
});

describe("🔄 лимит перерисовок: 3 на слово в день", () => {
  const alerts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "answerCallbackQuery" && c.payload.show_alert);
  const alert = (h: ReturnType<typeof botHarness>) => alerts(h).at(-1)?.payload.text;

  /**
   * Жмёт «🎲 Ещё вариант» `times` раз, каждый раз дожидаясь, пока картинка действительно уйдёт.
   *
   * Ждать обязательно: рисование уходит в `background`, и без ожидания следующее нажатие приходит, пока
   * предыдущее ещё рисуется — `inFlight` склеивает запросы, и «сколько раз нажали» перестаёт совпадать
   * с «сколько раз нарисовали». Ждём по отправке картинки, а не по вызову `draw`: `draw` — это только
   * начало работы, после него картинка ещё сжимается и отправляется.
   */
  async function redraw(h: ReturnType<typeof botHarness>, wordId: number, times: number, userId = 100) {
    const sent = () => h.calls.filter((c) => c.method === "sendPhoto").length;
    for (let i = 0; i < times; i++) {
      const before = h.calls.length;
      const photos = sent();
      await h.bot.handleUpdate(h.callback(userId, `rd:${wordId}`));
      await h.bot.handleUpdate(h.callback(userId, buttonData(h.calls.slice(before), "🎲 Ещё вариант")));
      await vi.waitFor(() => expect(sent()).toBeGreaterThan(photos));
    }
  }

  it("даёт три попытки и отказывает на четвёртой", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await redraw(h, w.id, 3);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(3));
    expect(alert(h)).toBeUndefined();

    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎲 Ещё вариант")));
    expect(draw).toHaveBeenCalledTimes(3);
    expect(alert(h)).toBe(QUOTAS.image_redraw.refusal);
  });

  it("считает попытки на каждое слово отдельно, а не на все сразу", async () => {
    const { h, draw } = setup();
    const first = await word(h);
    const user = (await h.db.select().from(users))[0];
    const second = await saveWord(h.db, {
      roomId: first.roomId,
      addedBy: user.id,
      draft: { term: "ladder", translation: "лестница", explanation: "", example: "" },
      now: T0,
    });
    if (second.status !== "saved") throw new Error("dup");
    await setImageFileId(h.db, second.word.id, "old-pic");

    // Три попытки выжимают первое слово до отказа…
    await redraw(h, first.id, 3);
    await h.bot.handleUpdate(h.callback(100, `rd:${first.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎲 Ещё вариант")));
    expect(alert(h)).toBe(QUOTAS.image_redraw.refusal);

    // …но у второго слова лимит свой, иначе одна картинка съедала бы попытки всех остальных.
    await redraw(h, second.word.id, 1);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(4));
  });

  it("лимит личный: чужие перерисовки не тратят мои", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await redraw(h, w.id, 3);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(3));

    // Второй участник той же комнаты: картинка общая, а лимит у каждого свой.
    const other = await makeUser(h.db, 200);
    await joinRoom(h.db, { roomId: w.roomId, userId: other.id, now: T0, makeCurrent: false });
    await h.bot.handleUpdate(h.callback(200, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(200, buttonData(h.calls, "🎲 Ещё вариант")));
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(4));
    expect(alert(h)).toBeUndefined();
  });

  it("отказ не тратит попытки: десять нажатий не сдвигают счёт", async () => {
    const { h } = setup();
    const w = await word(h);
    for (let i = 0; i < 10; i++) {
      await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
      await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎲 Ещё вариант")));
    }
    const user = (await h.db.select().from(users))[0];
    expect(await quotaUsed(h.db, { userId: user.id, kind: "image_redraw", timeZone: "UTC", now: T0, wordId: w.id })).toBe(3);
  });

  it("«✍️ Свой вариант» тоже расходует попытку — и спрашивает до, а не после", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await redraw(h, w.id, 3);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(3));

    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✍️ Свой вариант")));
    // Отказ приходит сразу, а не после того, как человек напишет описание.
    expect(alert(h)).toBe(QUOTAS.image_redraw.refusal);
    expect(h.calls.some((c) => String(c.payload.text).includes("Опиши картинку"))).toBe(false);
  });

  it("неучастник и удалённое слово не тратят попытку", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    const stranger = await makeUser(h.db, 300);

    await h.bot.handleUpdate(h.callback(300, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(300, buttonData(h.calls, "🎲 Ещё вариант")));
    expect(draw).not.toHaveBeenCalled();

    expect(await quotaUsed(h.db, { userId: stranger.id, kind: "image_redraw", timeZone: "UTC", now: T0, wordId: w.id })).toBe(0);
  });

  it("описание расходует одну попытку, а не две", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✍️ Свой вариант")));
    await h.bot.handleUpdate(h.message(100, "старый сундук"));
    await vi.waitFor(() => expect(draw).toHaveBeenCalled());

    const user = (await h.db.select().from(users))[0];
    expect(await quotaUsed(h.db, { userId: user.id, kind: "image_redraw", timeZone: "UTC", now: T0, wordId: w.id })).toBe(1);
  });

  it("на следующий день лимит снова полный", async () => {
    const { h, draw } = setup();
    const w = await word(h);
    await redraw(h, w.id, 3);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(3));
    await h.bot.handleUpdate(h.callback(100, `rd:${w.id}`));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🎲 Ещё вариант")));
    expect(alert(h)).toBe(QUOTAS.image_redraw.refusal);
    const refusals = alerts(h).length;

    h.setNow(at(DAY));
    await redraw(h, w.id, 1);
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(4));
    // Отказ выше остаётся в истории вызовов, поэтому смотрим, что новых отказов не добавилось.
    expect(alerts(h)).toHaveLength(refusals);
  });
});
