import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { ImageService } from "../src/images/images";
import { BackgroundPainter } from "../src/images/painter";
import { PictureStore } from "../src/images/store";
import type { ExerciseTutor } from "../src/llm/tutor";
import { answerCard } from "../src/services/review";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { MIN, T0, at, makeUser, testDb } from "./helpers";

const tutor = (): ExerciseTutor => ({
  cloze: async () => [],
  judge: async () => ({ correct: false, explanation: "", tip: "" }),
  drill: async () => [],
  mnemonics: async () => [],
  imagePrompt: async (word) => `scene for ${word.term}`,
});
const store = () => new PictureStore(mkdtempSync(join(tmpdir(), "pictures-")));

async function room(db: ReturnType<typeof testDb>) {
  const alice = await makeUser(db, 1);
  const r = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  const add = async (term: string, mnemonic: string, now = T0) => {
    const res = await saveWord(db, { roomId: r.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "", mnemonic }, now });
    if (res.status !== "saved") throw new Error("dup");
    return res.word;
  };
  return { alice, add };
}

describe("PictureStore", () => {
  it("keys pictures by word and translation, so an edited word needs a new one", async () => {
    const pictures = store();
    const word = { id: 7, term: "snag", translation: "урвать" };
    expect(pictures.find(word)).toBeUndefined();
    await pictures.save(word, Buffer.from("png"));
    expect(pictures.find(word)).toMatch(/7-[0-9a-f]+\.png$/);
    expect(pictures.find({ ...word, translation: "зацепка" })).toBeUndefined();
  });
});

describe("BackgroundPainter", () => {
  it("paints the hardest word first and saves it to disk, one per tick", async () => {
    const db = testDb();
    const { alice, add } = await room(db);
    await add("easy", "m1");
    const hard = await add("hard", "m2", at(MIN));
    const [hardCard] = await db.select().from(cards).where(eq(cards.wordId, hard.id));
    for (let i = 0; i < 4; i++) {
      const [c] = await db.select().from(cards).where(eq(cards.id, hardCard.id));
      await answerCard(db, { userId: alice.id, cardId: c.id, expectedReps: c.reps, answer: "again", now: at(i * MIN) });
    }
    const draw = vi.fn(async () => Buffer.from("png"));
    const t = tutor();
    const pictures = store();
    const painter = new BackgroundPainter({ db, images: new ImageService({ draw }, t), pictures, onPower: async () => true });
    expect(await painter.tick()).toBe("hard");
    expect(pictures.find({ id: hard.id, term: "hard", translation: "t" })).toBeDefined();
    expect(await painter.tick()).toBe("easy");
    expect(await painter.tick()).toBeUndefined();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("waits on battery and while someone's picture is being drawn", async () => {
    const db = testDb();
    const { add } = await room(db);
    await add("w", "m");
    const t = tutor();
    let release!: () => void;
    const draw = vi.fn(() => new Promise<Buffer>((r) => (release = () => r(Buffer.from("png")))));
    const images = new ImageService({ draw }, t);
    const onBattery = new BackgroundPainter({ db, images, pictures: store(), onPower: async () => false });
    expect(await onBattery.tick()).toBeUndefined();

    const userPicture = images.drawWord({ id: 999, term: "x", translation: "t", explanation: "", example: "" });
    const painter = new BackgroundPainter({ db, images, pictures: store(), onPower: async () => true });
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(await painter.tick()).toBeUndefined();
    release();
    await userPicture;
  });
});

describe("pictures from disk in the bot", () => {
  it("/learn sends a pre-painted picture from disk and remembers Telegram's file id", async () => {
    const pictures = store();
    const h = botHarness({ images: { draw: async () => Buffer.from("png") }, pictures });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const r = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const res = await saveWord(h.db, { roomId: r.id, addedBy: user.id, draft: { term: "beset by", translation: "t", explanation: "", example: "", mnemonic: "devils" }, now: T0 });
    if (res.status !== "saved") throw new Error("dup");
    await pictures.save(res.word, Buffer.from("png"));
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const photo = h.calls.filter((c) => c.method === "sendPhoto").at(-1)!;
    expect(typeof photo.payload.photo).not.toBe("string");
    await vi.waitFor(async () => expect((await getWord(h.db, res.word.id))?.imageFileId).toMatch(/^photo-file-/));
  });

  it("🖼 uses the picture from disk without drawing", async () => {
    const pictures = store();
    const draw = vi.fn(async () => Buffer.from("png"));
    const h = botHarness({ images: { draw }, pictures });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const r = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const res = await saveWord(h.db, { roomId: r.id, addedBy: user.id, draft: { term: "snag", translation: "t", explanation: "", example: "", mnemonic: "nail" }, now: T0 });
    if (res.status !== "saved") throw new Error("dup");
    await pictures.save(res.word, Buffer.from("png"));
    await h.bot.handleUpdate(h.callback(100, `im:${res.word.id}`));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendPhoto")).toBe(true));
    expect(draw).not.toHaveBeenCalled();
  });
});
