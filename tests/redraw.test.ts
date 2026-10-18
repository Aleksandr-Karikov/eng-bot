import { describe, expect, it, vi } from "vitest";
import type { ExerciseTutor } from "../src/llm/tutor";
import { buildImagePromptPrompt } from "../src/llm/tutor";
import { STYLE_PRESETS } from "../src/images/images";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, setImageFileId } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function setup(withImages = true) {
  const imagePrompt = vi.fn(async () => "an old family house");
  const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: async () => [], mnemonics: async () => [], story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt };
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
