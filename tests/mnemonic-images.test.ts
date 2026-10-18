import { describe, expect, it, vi } from "vitest";
import { ImageService } from "../src/images/images";
import { buildImagePromptPrompt, parseImagePrompt, type ExerciseTutor } from "../src/llm/tutor";
import { rateKeyboard } from "../src/bot/keyboards";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function tutor() {
  return {
    cloze: async () => [],
    judge: async () => ({ correct: false, explanation: "", tip: "" }),
    drill: async () => [],
    mnemonics: vi.fn(async (items: Array<{ term: string }>) => items.map(() => "Бесы осадили тебя, как крепость")),
    collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: vi.fn(async () => "a fortress besieged by an army, close-up"),
  } satisfies ExerciseTutor;
}

async function setup(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, {
    roomId: room.id,
    addedBy: user.id,
    draft: { term: "beset by", translation: "осаждаемый", explanation: "окружён проблемами", example: "beset by delays", mnemonic: "бесы" },
    now: T0,
  });
  if (r.status !== "saved") throw new Error("dup");
  return r.word;
}

const photos = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendPhoto");

describe("💡 old buttons", () => {
  it("still show the mnemonic under a spoiler", async () => {
    const h = botHarness({ tutor: tutor() });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `mn:${word.id}`));
    await vi.waitFor(() => expect(h.calls.some((c) => String(c.payload.text).includes("<tg-spoiler>бесы"))).toBe(true));
  });

  it("learn cards hide word actions behind one ⚙️ button", () => {
    const labels = rateKeyboard(1, 0, true, 5).inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("⚙️ Управление словом");
    expect(labels).not.toContain("🖼 Картинка");
  });
});

describe("🖼 pictures of the word", () => {
  it("draws the word's meaning once, sends it under a spoiler and reuses Telegram's file id", async () => {
    const t = tutor();
    const draw = vi.fn(async () => Buffer.from("png"));
    const h = botHarness({ tutor: t, images: { draw } });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `im:${word.id}`));
    await vi.waitFor(() => expect(photos(h)).toHaveLength(1));
    expect(t.imagePrompt).toHaveBeenCalledWith(expect.objectContaining({ term: "beset by", translation: "осаждаемый", example: "beset by delays" }));
    expect(draw).toHaveBeenCalledWith(expect.stringMatching(/^a fortress besieged by an army, close-up, .*black ink comic/));
    expect(photos(h)[0].payload).toMatchObject({ has_spoiler: true });
    expect(String(photos(h)[0].payload.caption)).toContain("<tg-spoiler>осаждаемый");
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.imageFileId).toMatch(/^photo-file-/));

    await h.bot.handleUpdate(h.callback(100, `im:${word.id}`));
    await vi.waitFor(() => expect(photos(h)).toHaveLength(2));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(photos(h)[1].payload.photo).toMatch(/^photo-file-/);
  });

  it("says pictures are off when the generator is disabled", async () => {
    const h = botHarness({ tutor: tutor() });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `im:${word.id}`));
    expect(String(h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.payload.text)).toContain("выключены");
  });

  it("forgets the picture when the meaning changes", async () => {
    const h = botHarness({ tutor: tutor(), images: { draw: async () => Buffer.from("png") } });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `im:${word.id}`));
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.imageFileId).not.toBeNull());
    await updateWord(h.db, word.id, { translation: "одолеваемый", explanation: "", example: "" });
    expect((await getWord(h.db, word.id))?.imageFileId).toBeNull();
  });
});

describe("picture prompts and the queue", () => {
  it("describes the meaning (not the mnemonic) and adds the configured style", async () => {
    const draw = vi.fn(async () => Buffer.from("png"));
    await new ImageService({ draw }, tutor(), "watercolor").drawWord({ id: 1, term: "t", translation: "x", explanation: "", example: "" });
    expect(draw).toHaveBeenCalledWith("a fortress besieged by an army, close-up, watercolor");
    expect(buildImagePromptPrompt({ term: "heritage", translation: "наследие", explanation: "", example: "" })).not.toMatch(/запоминалк/i);
    expect(parseImagePrompt(JSON.stringify({ prompt: "an old house" }))).toBe("an old house");
  });

  it("draws one picture at a time and only once per word", async () => {
    let running = 0;
    let maxRunning = 0;
    const draw = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return Buffer.from("png");
    });
    const service = new ImageService({ draw }, tutor());
    const w = (id: number) => ({ id, term: `w${id}`, translation: "t", explanation: "", example: "" });
    await Promise.all([service.drawWord(w(1)), service.drawWord(w(2)), service.drawWord(w(1))]);
    expect(maxRunning).toBe(1);
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
