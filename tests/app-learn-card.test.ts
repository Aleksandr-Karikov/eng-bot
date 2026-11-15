import { describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app/server";
import { cards, words } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { DAY, T0, makeUser } from "./helpers";

const TOKEN = "123:test-token";

/**
 * Режим заучивания (очередь /api/queue) когда-то отдавал только старый набор полей карточки:
 * часть речи, формы и родня были в базе, но до SwipeCard не доходили.
 */
async function setup(fill: boolean) {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, modeEnRu: true, modeCollocation: false, modeCloze: false, modeSentence: false, modeListen: false });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "variety", translation: "разнообразие", explanation: "", example: "A wide variety of shops.", usefulness: 3 }, now: T0 });
  if (saved.status !== "saved") throw new Error("fixture");
  if (fill) {
    await h.db.update(words).set({
      partOfSpeech: "существительное", cefr: "B1",
      forms: JSON.stringify([{ form: "varieties", label: "множественное число" }]),
      synonyms: JSON.stringify([{ term: "diversity", translation: "разнообразие" }]),
      antonyms: JSON.stringify([{ term: "uniformity", translation: "однородность" }]),
    }).where(eq(words.id, saved.word.id));
  }
  await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due: new Date(T0.getTime() - DAY) });
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}` };
  const { cards: queue } = await (await app.request("/api/queue", { headers })).json();
  return { h, queue };
}

describe("Mini App: карточка в режиме заучивания", () => {
  it("brings part of speech, level, forms and relatives to the learning card", async () => {
    const { queue } = await setup(true);
    expect(queue[0].word).toMatchObject({
      term: "variety",
      partOfSpeech: "существительное",
      cefr: "B1",
      forms: [{ form: "varieties", label: "множественное число" }],
      synonyms: [{ term: "diversity", translation: "разнообразие" }],
      antonyms: [{ term: "uniformity", translation: "однородность" }],
    });
  });

  it("still returns the card when grammar is not prepared yet", async () => {
    const { queue } = await setup(false);
    expect(queue[0].word).toMatchObject({ term: "variety", partOfSpeech: "", cefr: "", forms: [], synonyms: [], antonyms: [] });
  });

  it("prepares grammar when the learning queue hands out the card", async () => {
    const h = botHarness();
    const grammar = vi.fn(async () => ({
      partOfSpeech: "существительное", cefr: "B1", forms: [], synonyms: [], antonyms: [],
    }));
    h.deps.tutor = { ...h.deps.tutor, grammar };
    const { GrammarGenerator } = await import("../src/services/grammar");
    (h.deps as { grammarGen: unknown }).grammarGen = new GrammarGenerator(h.db, h.deps.tutor);
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, modeEnRu: true, modeCollocation: false, modeCloze: false, modeSentence: false, modeListen: false });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "variety", translation: "разнообразие", explanation: "", example: "", usefulness: 3 }, now: T0 });
    if (saved.status !== "saved") throw new Error("fixture");
    await h.db.update(cards).set({ state: 2, stability: 5, reps: 3, due: new Date(T0.getTime() - DAY) });
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    await app.request("/api/queue", { headers: { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}` } });
    await vi.waitFor(() => expect(grammar).toHaveBeenCalled());
  });
});
