import { describe, expect, it } from "vitest";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";
import { saveWord } from "../src/services/words";
import { ensurePersonalRoom } from "../src/services/rooms";
import { findInlineWords, INLINE_LIMIT, INLINE_MIN_CHARS } from "../src/services/inline";

/** Готовит человека с личным словарём и словами в нём — как после обычного «пришли слово в личку». */
async function withWords(h: ReturnType<typeof botHarness>, userId: number, terms: Array<[string, string]>) {
  const user = await makeUser(h.db, userId);
  const room = await ensurePersonalRoom(h.db, user.id, T0);
  for (const [term, translation] of terms) {
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation, explanation: "", example: "" }, now: T0 });
  }
  return { user, room };
}

const lastInline = (h: ReturnType<typeof botHarness>) => {
  const call = [...h.calls].reverse().find((c) => c.method === "answerInlineQuery");
  return call?.payload as { results?: Array<{ title: string; description: string; input_message_content: { message_text: string } }> } | undefined;
};

const titles = (h: ReturnType<typeof botHarness>) => lastInline(h)?.results?.map((r) => r.title) ?? [];

describe("инлайн-режим", () => {
  it("находит слово по началу и отдаёт перевод прямо в карточке", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик, измеритель"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "gau"));

    expect(titles(h)).toEqual(["gauge"]);
    const card = lastInline(h)!.results![0];
    expect(card.input_message_content.message_text).toContain("датчик, измеритель");
  });

  it("точное совпадение идёт первым, а не самое короткое", async () => {
    const h = botHarness();
    await withWords(h, 100, [
      ["gauge", "датчик"],
      ["gauges", "датчики"],
    ]);

    await h.bot.handleUpdate(h.inlineQuery(100, "gauge"));

    expect(titles(h)[0]).toBe("gauge");
  });

  it("не отдаёт ничего на одну букву — словарь не должен угадывать", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "g"));

    expect(titles(h)).toEqual([]);
    expect(INLINE_MIN_CHARS).toBe(2);
  });

  it("пустой запрос не падает и не показывает весь словарь", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "   "));

    expect(titles(h)).toEqual([]);
    // Подсказка-кнопка: человеку объясняют, что делать, вместо пустого списка.
    const call = [...h.calls].reverse().find((c) => c.method === "answerInlineQuery");
    expect(call?.payload.button).toBeTruthy();
  });

  it("не показывает чужие слова", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(555, "gau"));

    expect(titles(h)).toEqual([]);
  });

  it("одно и то же слово из двух комнат показывается один раз", async () => {
    const h = botHarness();
    const { user } = await withWords(h, 100, [["gauge", "датчик"]]);
    // Вторая комната того же человека с тем же словом.
    const second = await ensurePersonalRoom(h.db, user.id, T0, "en");
    await saveWord(h.db, { roomId: second.id, addedBy: user.id, draft: { term: "gauge", translation: "датчик", explanation: "", example: "" }, now: T0 });

    await h.bot.handleUpdate(h.inlineQuery(100, "gau"));

    expect(titles(h)).toEqual(["gauge"]);
  });

  it("обрезка до лимита подсказок", async () => {
    const h = botHarness();
    const many: Array<[string, string]> = Array.from({ length: INLINE_LIMIT + 4 }, (_, i) => [`word${i}`, `перевод${i}`]);
    await withWords(h, 100, many);

    await h.bot.handleUpdate(h.inlineQuery(100, "word"));

    expect(titles(h)).toHaveLength(INLINE_LIMIT);
  });

  it("не зовёт модель: инлайн обязан ответить мгновенно", async () => {
    let called = 0;
    const h = botHarness({
      enricher: {
        enrich: async () => {
          called++;
          return { translation: "x", explanation: "", example: "" };
        },
        extractImage: async () => [],
        extract: async () => [],
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
    });
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "gau"));

    expect(called).toBe(0);
  });

  it("кнопка «В мой словарь» копирует слово и не зовёт модель", async () => {
    let called = 0;
    const h = botHarness({
      enricher: {
        enrich: async () => {
          called++;
          return { translation: "x", explanation: "", example: "" };
        },
        extractImage: async () => [],
        extract: async () => [],
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
    });
    const { user } = await withWords(h, 555, [["gauge", "датчик, измеритель"]]);

    await h.bot.handleUpdate(h.callback(100, "iw:1"));

    expect(called).toBe(0);
    expect(await findInlineWords(h.db, (await makeUser(h.db, 100)).id, "gauge")).toHaveLength(1);
    expect(user.id).not.toBe(100);
  });

  it("повторное нажатие не дублирует слово", async () => {
    const h = botHarness();
    await withWords(h, 555, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.callback(100, "iw:1"));
    await h.bot.handleUpdate(h.callback(100, "iw:1"));

    const hits = await findInlineWords(h.db, (await makeUser(h.db, 100)).id, "gauge");
    expect(hits).toHaveLength(1);
  });

  it("на удалённое слово кнопка отвечает, а не молчит", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.callback(100, "iw:999"));

    const call = [...h.calls].reverse().find((c) => c.method === "answerCallbackQuery");
    expect(String(call?.payload.text)).toContain("удалили");
  });
});

describe("инлайн у человека без словаря", () => {
  it("новичок без комнат получает пустой ответ, а не ошибку", async () => {
    const h = botHarness();

    await h.bot.handleUpdate(h.inlineQuery(777, "gauge"));

    expect(titles(h)).toEqual([]);
    // Middleware не должен падать на апдейте без chat: иначе бот ответит «Что-то пошло не так».
    const failed = h.calls.filter((c) => c.method === "sendMessage" && String(c.payload.text).includes("Что-то пошло не так"));
    expect(failed).toEqual([]);
  });

  it("кнопка «В мой словарь» заводит личный словарь новичку", async () => {
    const h = botHarness();
    await withWords(h, 555, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.callback(777, "iw:1"));

    const hits = await findInlineWords(h.db, (await makeUser(h.db, 777)).id, "gauge");
    expect(hits).toHaveLength(1);
  });
});
