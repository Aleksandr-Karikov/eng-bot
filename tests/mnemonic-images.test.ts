import { describe, expect, it, vi } from "vitest";
import type { ExerciseTutor } from "../src/llm/tutor";
import { ImageService } from "../src/images/images";
import { rateKeyboard } from "../src/bot/keyboards";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, setMnemonic, updateWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

function tutor() {
  return {
    cloze: async () => [],
    judge: async () => ({ correct: false, explanation: "", tip: "" }),
    drill: async () => [],
    mnemonic: vi.fn(async () => "Бесы осадили тебя, как крепость"),
    imagePrompt: vi.fn(async () => "a man surrounded by little devils, cartoon"),
  } satisfies ExerciseTutor;
}

async function setup(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "beset by", translation: "осаждаемый", explanation: "", example: "" }, now: T0 });
  if (r.status !== "saved") throw new Error("dup");
  return r.word;
}

const photos = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendPhoto");

describe("💡 mnemonic on demand", () => {
  it("offers 🖼 on learn cards when pictures are on", () => {
    const labels = rateKeyboard(1, 0, true, 5, false, true).inline_keyboard.flat().map((b) => b.text);
    expect(labels).toContain("🖼 Картинка");
  });

  it("asks Claude once, shows it under a spoiler and reuses it afterwards", async () => {
    const t = tutor();
    const h = botHarness({ tutor: t });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `mn:${word.id}`));
    await vi.waitFor(() => expect(h.calls.some((c) => String(c.payload.text).includes("<tg-spoiler>Бесы осадили"))).toBe(true));
    await h.bot.handleUpdate(h.callback(100, `mn:${word.id}`));
    await vi.waitFor(() => expect(h.calls.filter((c) => String(c.payload.text).includes("<tg-spoiler>Бесы"))).toHaveLength(2));
    expect(t.mnemonic).toHaveBeenCalledTimes(1);
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🖼 Нарисовать");
  });
});

describe("🖼 pictures", () => {
  it("draws the mnemonic scene once, sends it under a spoiler and reuses Telegram's file id", async () => {
    const t = tutor();
    const draw = vi.fn(async () => Buffer.from("png"));
    const h = botHarness({ tutor: t, images: { draw } });
    const word = await setup(h);
    await h.bot.handleUpdate(h.callback(100, `mn:${word.id}`));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "🖼 Нарисовать")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🖼 Нарисовать")));
    await vi.waitFor(() => expect(photos(h)).toHaveLength(1));
    expect(draw).toHaveBeenCalledWith("a man surrounded by little devils, cartoon");
    expect(t.imagePrompt).toHaveBeenCalledWith("beset by", "осаждаемый", "Бесы осадили тебя, как крепость");
    expect(photos(h)[0].payload).toMatchObject({ has_spoiler: true });
    expect(String(photos(h)[0].payload.caption)).toContain("Бесы осадили");
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
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("выключены");
  });

  it("forgets the picture when the meaning changes", async () => {
    const h = botHarness({ tutor: tutor(), images: { draw: async () => Buffer.from("png") } });
    const word = await setup(h);
    await setMnemonic(h.db, word.id, "m");
    await h.bot.handleUpdate(h.callback(100, `im:${word.id}`));
    await vi.waitFor(async () => expect((await getWord(h.db, word.id))?.imageFileId).not.toBeNull());
    await updateWord(h.db, word.id, { translation: "одолеваемый", explanation: "", example: "" });
    expect((await getWord(h.db, word.id))?.imageFileId).toBeNull();
  });
});

describe("ImageService", () => {
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
    const w = (id: number) => ({ id, term: `w${id}`, translation: "t", mnemonic: "m" });
    await Promise.all([service.drawWord(w(1)), service.drawWord(w(2)), service.drawWord(w(1))]);
    expect(maxRunning).toBe(1);
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
