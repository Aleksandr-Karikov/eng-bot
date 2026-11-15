import { describe, expect, it, vi } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import type { WordGrammar } from "../src/llm/tutor";
import { botHarness } from "./bot-harness";
import { makeUser, T0 } from "./helpers";

const TOKEN = "123:test-token";
const grammar: WordGrammar = {
  partOfSpeech: "существительное",
  cefr: "B1",
  forms: [{ form: "varieties", label: "множественное число" }],
  synonyms: [{ term: "diversity", translation: "разнообразие" }],
  antonyms: [{ term: "uniformity", translation: "однородность" }],
};

async function setup() {
  const h = botHarness();
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(h.db, {
    roomId: room.id, addedBy: user.id, now: T0,
    draft: { term: "variety", translation: "разнообразие", explanation: "с of", example: "A wide variety of shops." },
  });
  if (saved.status !== "saved") throw new Error("fixture");
  h.deps.tutor = { ...h.deps.tutor, grammar: vi.fn(async () => grammar) };
  (h.deps as { grammarGen: unknown }).grammarGen = new (await import("../src/services/grammar")).GrammarGenerator(h.db, h.deps.tutor);
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Test" } }, TOKEN, new Date())}` };
  const open = () => app.request(`/api/words/${saved.word.id}`, { headers });
  return { h, user, word: saved.word, open };
}

describe("Mini App: карточка слова показывает грамматику", () => {
  it("opens a word before learning: fields come from the card, grammar is prepared", async () => {
    const { h, open } = await setup();
    // Пользователь открыл слово из списка — оно ещё ни разу не показывалось в обучении.
    const first = await (await open()).json();
    expect(first.word).toMatchObject({ term: "variety", partOfSpeech: "", cefr: "", forms: [], synonyms: [], antonyms: [] });

    // Генерация запускается открытием карточки, а не только очередью обучения.
    await vi.waitFor(() => expect(h.deps.tutor.grammar).toHaveBeenCalled());

    const second = await (await open()).json();
    expect(second.word).toMatchObject({
      partOfSpeech: "существительное",
      cefr: "B1",
      forms: [{ form: "varieties", label: "множественное число" }],
      synonyms: [{ term: "diversity", translation: "разнообразие" }],
      antonyms: [{ term: "uniformity", translation: "однородность" }],
    });
  });
});
