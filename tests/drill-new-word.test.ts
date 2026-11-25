import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/llm/enricher";
import type { DrillQuestion, ExerciseTutor } from "../src/llm/tutor";
import { parseDrill } from "../src/llm/tutor";
import { recordMistakes } from "../src/services/mistakes";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

/**
 * Баг #26: «мне нужно было подобрать слово, которое больше всего подходит к слову overcome,
 * но оказалось, что подходящее слово вообще мной не изучено».
 *
 * Вопрос по ошибкам проверяет **правило**, а не лексику, но иногда опирается на слово не из словаря
 * ученика. Запрещать такие слова — обеднить вопросы и всё равно не гарантия: тема ошибки и лексика
 * не связаны. Поэтому слово можно посмотреть и сразу добавить, не выходя из вопроса.
 *
 * Проверяется путь: модель называет незнакомое слово → в вопросе есть кнопка перевода → по ней
 * показывается слово с переводом → добавление кладёт его в словарь тем же путём, что `/add`.
 */
const checked: CheckResult = { corrected: "", fixes: [], natural: "" };

const withNewWord: DrillQuestion = {
  question: "She managed to overcome ___ despite the difficult circumstances.",
  options: ["obstacles", "hardships", "troubles"],
  correct: 0,
  explanation: "overcome obstacles — устойчивое сочетание",
  category: "выбор слова",
  newWord: { term: "obstacle", translation: "препятствие, помеха" },
};

function harness(questions: DrillQuestion[] = [withNewWord, { ...withNewWord, question: "Second ___ question." }]) {
  const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: vi.fn(async () => questions), mnemonics: async () => [], translationTask: async () => ({ ru: "Привет", en: "Hi", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "" };
  const h = botHarness({
    tutor,
    enricher: {
      enrich: async () => ({ term: "obstacle", translation: "препятствие, помеха", explanation: "то, что мешает", example: "An obstacle in the way.", sense: "main" as const, register: "neutral" as const }),
      extractImage: async () => [],
      extract: async () => [],
      check: async () => checked,
    },
  });
  return { h };
}

const sent = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

/** Ученик с ошибкой, чтобы вопросы вообще готовились, и с комнатой — чтобы было куда добавлять. */
async function learner(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await updateUser(h.db, user.id, { currentRoomId: room.id });
  await recordMistakes(h.db, user.id, [{ wrong: "a apple", right: "an apple", why: "артикль", category: "артикли" }], T0);
  return { user, room };
}

describe("#26: незнакомое слово в вопросе по ошибкам", () => {
  it("модель может назвать незнакомое слово и его перевод, а пустое поле не мешает", () => {
    const [withWord, without] = parseDrill(JSON.stringify([
      { question: "She managed to overcome ___.", options: ["a", "b"], correct: 0, explanation: "x", category: "c", new_word: "obstacle", new_word_translation: "препятствие" },
      { question: "Tomorrow I ___ my mom.", options: ["visit", "visited"], correct: 0, explanation: "простое", category: "времена", new_word: "", new_word_translation: "" },
    ]));
    expect(withWord.newWord).toEqual({ term: "obstacle", translation: "препятствие" });
    // Пустые поля не превращаются в пустое незнакомое слово.
    expect(without.newWord).toBeUndefined();
  });

  it("в вопросе есть кнопка перевода, по ней — слово с переводом и «Добавить»", async () => {
    const { h } = harness();
    await learner(h);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    expect(sent(h).at(-1)).toContain("overcome ___");

    const translate = buttonData(h.calls, "🔍 Что такое «obstacle»?");
    expect(translate, "кнопка перевода должна быть в вопросе").toBeTruthy();
    await h.bot.handleUpdate(h.callback(100, translate));
    const shown = sent(h).at(-1) ?? "";
    expect(shown).toContain("obstacle");
    expect(shown).toContain("препятствие");
    expect(buttonData(h.calls, "➕ Добавить")).toBeTruthy();
  });

  it("«Добавить» кладёт слово в словарь комнаты", async () => {
    const { h } = harness();
    const { room } = await learner(h);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔍 Что такое «obstacle»?")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Добавить")));
    const { words } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const saved = await h.db.select().from(words).where(eq(words.roomId, room.id));
    expect(saved.map((w) => w.term)).toContain("obstacle");
    expect(sent(h).at(-1)).toContain("Добавил");
  });

  it("вопрос без незнакомого слова не получает лишней кнопки", async () => {
    const { h } = harness([{ ...withNewWord, newWord: undefined }, { ...withNewWord, question: "Второй ___." }]);
    await learner(h);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    // buttonData бросает, если кнопки нет, — поэтому проверяем по списку кнопок.
    expect(lastButtons(h.calls).map((b) => b.text).some((t) => t.startsWith("🔍"))).toBe(false);
    expect(sent(h).at(-1)).toContain("overcome ___");
  });
});
