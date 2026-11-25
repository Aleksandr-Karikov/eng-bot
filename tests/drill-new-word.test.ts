import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/llm/enricher";
import type { DrillQuestion } from "../src/llm/tutor";
import { checkAndCount, quotaUsed, QUOTAS } from "../src/services/limits";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { listRoomWords, saveWord } from "../src/services/words";
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
  const enrich = vi.fn(async (term: string) => ({ term, translation: `перевод ${term}`, explanation: "смысл", example: "An example." }));
  const h = botHarness({
    enricher: {
      enrich,
      extractImage: async () => [],
      extract: async () => [],
      check: async () => checked,
    },
  });
  h.deps.tutor.drill = async () => questions;
  return { h, enrich };
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
  it("переводит по нажатию и сохраняет показанное слово в исходную комнату с квотами /add", async () => {
    const { h, enrich } = harness([question(), question({ question: "He noticed the ___." })]);
    const { user, room } = await learner(h);
    const quota = { userId: user.id, timeZone: user.timezone, now: T0 };
    await h.bot.handleUpdate(h.message(100, "/drill"));
    const lookup = await vi.waitFor(() => buttonData(h.calls, "🔍 Что такое «managed»?"));
    expect(enrich).not.toHaveBeenCalled();
    await h.bot.handleUpdate(h.callback(100, lookup));
    await vi.waitFor(() => expect(sent(h).at(-1)).toContain("перевод managed"));
    const add = buttonData(h.calls, "➕ Добавить");
    expect(await quotaUsed(h.db, { ...quota, kind: "draft" })).toBe(1);
    expect(await quotaUsed(h.db, { ...quota, kind: "add_word" })).toBe(0);

    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "hardships")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "▶ Дальше")));
    expect(lastButtons(h.calls).some((button) => button.text.includes("noticed"))).toBe(true);
    const other = await createRoom(h.db, { name: "Другая", createdBy: user.id, now: T0 });
    await updateUser(h.db, user.id, { currentRoomId: other.id });
    await h.bot.handleUpdate(h.callback(100, add));

    expect(await listRoomWords(h.db, room.id)).toMatchObject([{ term: "managed", translation: "перевод managed" }]);
    expect(await listRoomWords(h.db, other.id)).toEqual([]);
    expect(await quotaUsed(h.db, { ...quota, kind: "add_word" })).toBe(1);
    expect(await quotaUsed(h.db, { ...quota, kind: "add_word_week" })).toBe(1);
    expect(sent(h).at(-1)).toContain("✅ Добавлено");
  });

  it("предлагает незнакомый правильный вариант только после ответа", async () => {
    const { h } = harness([question({ question: "She managed to overcome ___." })]);
    const { user, room } = await learner(h);
    for (const term of ["manage", "overcome"]) {
      await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: "x", explanation: "", example: "" }, now: T0 });
    }
    await h.bot.handleUpdate(h.message(100, "/drill"));
    const pick = await vi.waitFor(() => buttonData(h.calls, "hardships"));
    expect(lastButtons(h.calls).map((button) => button.text)).toEqual(["obstacles", "hardships", "troubles"]);
    await h.bot.handleUpdate(h.callback(100, pick));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔍 Перевод «obstacles»")));
    await vi.waitFor(() => expect(sent(h).at(-1)).toContain("перевод obstacles"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "➕ Добавить")));
    expect((await listRoomWords(h.db, room.id)).find((word) => word.term === "obstacles")).toMatchObject({
      context: "She managed to overcome obstacles.",
    });
  });

  it("при исчерпанной квоте черновиков отказывает до запроса к модели", async () => {
    const { h, enrich } = harness();
    const { user } = await learner(h);
    for (let i = 0; i < QUOTAS.draft.limit; i++) {
      await checkAndCount(h.db, { userId: user.id, timeZone: user.timezone, now: T0, kind: "draft" });
    }
    await h.bot.handleUpdate(h.message(100, "/drill"));
    const lookup = await vi.waitFor(() => buttonData(h.calls, "🔍 Что такое «managed»?"));
    await h.bot.handleUpdate(h.callback(100, lookup));
    await vi.waitFor(() => expect(sent(h).at(-1)).toContain(QUOTAS.draft.refusal));
    expect(enrich).not.toHaveBeenCalled();
  });

  it("если человек знает все слова вопроса — кнопки нет", async () => {
    const { h } = harness();
    const { user, room } = await learner(h);
    // Ученик уже знает все содержательные слова вопроса — предлагать нечего, кнопки нет.
    for (const term of ["managed", "overcome", "despite", "difficult", "circumstances"]) {
      await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: "x", explanation: "", example: "" }, now: T0 });
    }
    await h.bot.handleUpdate(h.message(100, "/drill"));
    await vi.waitFor(() => expect(sent(h).at(-1)).toContain("overcome ___"));
    expect(lastButtons(h.calls).map((button) => button.text)).toEqual(["obstacles", "hardships", "troubles"]);
  });

});
