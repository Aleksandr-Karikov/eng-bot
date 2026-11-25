import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/llm/enricher";
import type { DrillQuestion, ExerciseTutor } from "../src/llm/tutor";
import { recordMistakes } from "../src/services/mistakes";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

/**
 * Баг #26: незнакомое слово в вопросе по ошибкам — перевод по кнопке и добавление.
 *
 * Незнакомое слово определяет **не модель и не частотность**, а словарь человека:
 * `missingFrom` ищет слово из предложения, которого нет в карточках. На двух живых прогонах модель
 * не назвала ни одного слова полем `new_word`, хотя её об этом просили; частотный порог тоже не
 * нашёл ничего, потому что вопросы составляются из обиходных слов. Проверка по словарю — измерение
 * по данным человека, а не догадка.
 *
 * Здесь проверяется вторая половина: что человек видит кнопку, получает слово и может его добавить.
 */
// Проверка должна найти настоящую ошибку: без неё /check не предлагает сохранить её в работу над ошибками.
const checked: CheckResult = {
  corrected: "I **went** there",
  fixes: [{ wrong: "go", right: "went", why: "прошлое время", category: "времена" }],
  natural: "",
};

/** Вопрос, где слово `circumstances` заведомо не из словаря ученика. */
const question = (extra: Partial<DrillQuestion> = {}): DrillQuestion => ({
  question: "She managed to overcome ___ despite the difficult circumstances.",
  options: ["obstacles", "hardships", "troubles"],
  correct: 0,
  explanation: "overcome obstacles — устойчивое сочетание",
  category: "выбор слова",
  ...extra,
});

function harness(questions: DrillQuestion[] = [question()]) {
  const tutor: ExerciseTutor = { cloze: async () => [], judge: async () => ({ correct: false, explanation: "", tip: "" }), drill: vi.fn(async () => questions), mnemonics: async () => [], translationTask: async () => ({ ru: "Привет", en: "Hi", topic: "", word: "" }), reviewTranslation: async () => ({ correct: true, fixes: [], corrected: "", natural: "", usedWord: null, verdict: "" }), collocations: async () => ({ items: [] }), story: async () => ({ title: "", body: "", questions: [] }), say: async () => ({ variants: [{ text: "x", register: "", note: "" }], learn: [] }), talkReply: async () => "Hi!", talkReview: async () => ({ praise: "", fixes: [], natural: [], usedWords: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "" };
  const h = botHarness({
    tutor,
    enricher: {
      // Эхо: бот сам решает, какое слово предложить, — фейк возвращает то, что спросили.
      enrich: async (term: string) => ({ term, translation: `перевод ${term}`, explanation: "смысл", example: "An example.", sense: "main" as const, register: "neutral" as const }),
      extractImage: async () => [],
      extract: async () => [],
      check: async () => checked,
    },
  });
  return { h };
}

const sent = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.payload.text));

/**
 * Ученик с ошибкой и комнатой. Ошибка пишется через /check — так же, как в жизни: `mistakes` создаёт
 * только этот путь, и подкладывать их в базу напрямую значило бы проверять то, чего не бывает.
 */
async function learner(h: ReturnType<typeof botHarness>) {
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await updateUser(h.db, user.id, { currentRoomId: room.id });
  await h.bot.handleUpdate(h.message(100, "/check I go there"));
  await vi.waitFor(() => expect(sent(h).some((t) => t.includes("Сохранить"))).toBe(true));
  await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Сохранить")));
  return { user, room };
}

describe("#26: незнакомое слово в вопросе по ошибкам", () => {
  it("в вопросе есть кнопка слова, по ней — слово и «Добавить»", async () => {
    const { h } = harness();
    await learner(h);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    expect(sent(h).at(-1)).toContain("overcome ___");

    // prepareDrill сам находит недостающее слово — это `managed`, а не то, что мы положили в фикстуру.
    const translate = buttonData(h.calls, "🔍 Что такое «");
    await h.bot.handleUpdate(h.callback(100, translate));
    expect(sent(h).at(-1)).toContain("managed");
    expect(buttonData(h.calls, "➕ Добавить")).toBeTruthy();
  });

  it("«Добавить» кладёт слово в словарь комнаты и говорит об этом", async () => {
    const { h } = harness([question({ newWord: { term: "circumstances" } }), question()]);
    const { room } = await learner(h);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    const word = buttonData(h.calls, "🔍 Что такое «");
    await h.bot.handleUpdate(h.callback(100, word));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Добавить")));

    const { words } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const saved = await h.db.select().from(words).where(eq(words.roomId, room.id));
    // Добавилось то слово, которое предложил бот, — оно и должно появиться в словаре.
    expect(saved.length).toBeGreaterThan(0);
    expect(sent(h).at(-1)).toContain("Добавил");
  });

  it("если человек знает все слова вопроса — кнопки нет", async () => {
    const { h } = harness();
    const { user, room } = await learner(h);
    // Ученик уже знает все содержательные слова вопроса — предлагать нечего, кнопки нет.
    for (const term of ["managed", "overcome", "despite", "difficult", "circumstances"]) {
      await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: "x", explanation: "", example: "" }, now: T0 });
    }
    // /drill читает пользователя из базы при каждом апдейте, но вопросы могли уже полежать в памяти
    // от прошлого вызова — сбрасываем состояние, иначе проверяем старый набор.
    h.deps.drills.delete(user.id);
    await h.bot.handleUpdate(h.message(100, "/drill"));
    // Кнопки именно последнего сообщения: в истории вызовов есть и прошлые вопросы.
    const last = h.calls.filter((c) => c.payload.reply_markup).at(-1);
    const texts = ((last?.payload.reply_markup as { inline_keyboard?: Array<Array<{ text: string }>> }).inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts.some((t) => t.startsWith("🔍")), `кнопки: ${texts.join(" | ")}`).toBe(false);
  });

});
