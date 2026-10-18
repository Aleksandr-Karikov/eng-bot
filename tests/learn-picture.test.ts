import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord, setImageFileId } from "../src/services/words";
import { botHarness, lastButtons } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

async function setup(h: ReturnType<typeof botHarness>, withPicture: boolean, longExample = false) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const r = await saveWord(h.db, {
    roomId: room.id,
    addedBy: user.id,
    draft: { term: "beset by", translation: "осаждаемый", explanation: "", example: longExample ? "x".repeat(1100) : "", mnemonic: "бесы" },
    now: T0,
  });
  if (r.status !== "saved") throw new Error("dup");
  if (withPicture) await setImageFileId(h.db, r.word.id, "pic-file-1");
  return { user, word: r.word };
}

const draw = { draw: async () => Buffer.from("png") };
const lastCard = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage" || c.method === "sendPhoto").at(-1)!;

describe("/learn cards with a picture", () => {
  it("sends the card as the picture with the card text as caption and the rating buttons", async () => {
    const h = botHarness({ images: draw });
    await setup(h, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const card = lastCard(h);
    expect(card.method).toBe("sendPhoto");
    expect(card.payload.photo).toBe("pic-file-1");
    expect(card.payload.has_spoiler).toBeFalsy();
    expect(String(card.payload.caption)).toContain("<tg-spoiler>осаждаемый");
    const labels = lastButtons(h.calls).map((b) => b.text);
    expect(labels).toContain("😎 Помню");
    expect(labels).not.toContain("🖼 Картинка");
  });

  it("falls back to text when pictures are off for the user, absent, or the caption is too long", async () => {
    const off = botHarness({ images: draw });
    const { user } = await setup(off, true);
    await updateUser(off.db, user.id, { cardHidden: "picture" });
    await off.bot.handleUpdate(off.message(100, "/learn"));
    expect(lastCard(off).method).toBe("sendMessage");

    const none = botHarness({ images: draw });
    await setup(none, false);
    await none.bot.handleUpdate(none.message(100, "/learn"));
    expect(lastCard(none).method).toBe("sendMessage");
    await none.bot.handleUpdate(none.manage(100));
    expect(lastButtons(none.calls).map((b) => b.text)).toContain("🖼 Картинка");

    const long = botHarness({ images: draw });
    await setup(long, true, true);
    await long.bot.handleUpdate(long.message(100, "/learn"));
    expect(lastCard(long).method).toBe("sendMessage");
  });

  it("does not show the picture on the fill-in-the-gap stage", async () => {
    const h = botHarness({ images: draw, random: () => 0.99 });
    const { word } = await setup(h, true);
    await h.db.update(cards).set({ state: 2, stability: 20, reps: 3, due: new Date(T0.getTime() - DAY) }).where(eq(cards.wordId, word.id));
    const { saveCloze } = await import("../src/services/cloze");
    await saveCloze(h.db, word.id, [{ sentence: "We were ___ problems.", answer: "beset by", translation: "" }], T0);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(lastCard(h).method).toBe("sendMessage");
  });

  it("replaces the picture card with the next one after rating", async () => {
    const h = botHarness({ images: draw });
    const { user } = await setup(h, true);
    await h.bot.handleUpdate(h.message(100, "/learn"));
    const [card] = await h.db.select().from(cards).where(eq(cards.userId, user.id));
    const before = h.calls.length;
    await h.bot.handleUpdate(h.callback(100, `r:${card.id}:0:g`));
    expect(h.calls.slice(before).map((c) => c.method)).toContain("deleteMessage");
  });
});
