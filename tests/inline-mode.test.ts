import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";
import { saveWord } from "../src/services/words";
import { ensurePersonalRoom } from "../src/services/rooms";
import { findInlineWords, INLINE_LIMIT, INLINE_MIN_CHARS } from "../src/services/inline";
import { QUOTAS, quotaUsed } from "../src/services/limits";
import { usageCounters } from "../src/db/schema";
import type { Enrichment } from "../src/llm/enricher";
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

/** Подмена модели, которая умеет быстрый перевод: без неё инлайн не переводит новое (и это тоже проверяем). */
const fastEnricher = (calls: string[], translation = "вездесущий") => ({
  enrich: async (): Promise<Enrichment> => ({ translation, explanation: "", example: "" }),
  enrichFast: async (term: string): Promise<Enrichment> => {
    calls.push(term);
    return { term, translation, explanation: "встречается всюду", example: "Phones are ubiquitous." };
  },
  extract: async (): Promise<never[]> => [],
  extractImage: async (): Promise<never[]> => [],
  check: async () => ({ corrected: "", fixes: [], natural: "" }),
});

describe("инлайн переводит новое слово", () => {
  it("незнакомое слово переводится и встаёт первой карточкой", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });

    await h.bot.handleUpdate(h.inlineQuery(100, "ubiquitous"));

    expect(calls).toEqual(["ubiquitous"]);
    expect(titles(h)[0]).toBe("ubiquitous");
    expect(lastInline(h)!.results![0].input_message_content.message_text).toContain("вездесущий");
  });

  it("найденное слово не тратит лимит и не зовёт модель", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "gauge"));

    expect(calls).toEqual([]);
    const [row] = await h.db.select().from(usageCounters).where(eq(usageCounters.kind, "inline_translate"));
    expect(row).toBeUndefined();
  });

  it("без enrichFast инлайн не переводит, но поиск по словарю работает", async () => {
    const h = botHarness();
    await withWords(h, 100, [["gauge", "датчик"]]);

    await h.bot.handleUpdate(h.inlineQuery(100, "ubiquitous"));
    expect(titles(h)).toEqual([]);

    await h.bot.handleUpdate(h.inlineQuery(100, "gauge"));
    expect(titles(h)).toEqual(["gauge"]);
  });

  it("мусор и предложения не уходят в модель", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });

    await h.bot.handleUpdate(h.inlineQuery(100, "aaa"));
    await h.bot.handleUpdate(h.inlineQuery(100, "...."));
    await h.bot.handleUpdate(h.inlineQuery(100, "это целое предложение из многих слов, его переводить не надо"));

    expect(calls).toEqual([]);
  });

  it("короткая фраза переводится, длинная — нет", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });

    await h.bot.handleUpdate(h.inlineQuery(100, "set off"));
    expect(calls).toEqual(["set off"]);

    calls.length = 0;
    await h.bot.handleUpdate(h.inlineQuery(100, "это целое предложение из многих слов, его переводить не надо"));
    expect(calls).toEqual([]);
  });

  it("после лимита переводов модель больше не зовут", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });
    const user = await makeUser(h.db, 100);

    for (let i = 0; i < QUOTAS.inline_translate.limit + 3; i++) {
      await h.bot.handleUpdate(h.inlineQuery(100, `word${i}x`));
    }

    expect(calls).toHaveLength(QUOTAS.inline_translate.limit);
    const used = await quotaUsed(h.db, { userId: user.id, kind: "inline_translate", timeZone: "Europe/Moscow", now: T0 });
    expect(used).toBe(QUOTAS.inline_translate.limit);
  });

  it("кнопка «Добавить в словарь» кладёт слово в личный словарь", async () => {
    const h = botHarness({ enricher: fastEnricher([]) });
    const user = await makeUser(h.db, 100);

    await h.bot.handleUpdate(h.callback(100, "in:ubiquitous"));

    const hits = await findInlineWords(h.db, user.id, "ubiquitous");
    expect(hits).toHaveLength(1);
    expect(hits[0].word.translation).toBe("вездесущий");
  });

  it("кнопка в чужом чате не сохраняет, а ведёт в личку", async () => {
    const h = botHarness({ enricher: fastEnricher([]) });
    const user = await makeUser(h.db, 100);

    // Нажатие из группы: личного словаря там нет, сохранять некуда.
    await h.bot.handleUpdate(h.callback(100, "in:ubiquitous", { chatType: "group" }));

    expect(await findInlineWords(h.db, user.id, "ubiquitous")).toHaveLength(0);
    const reply = [...h.calls].reverse().find((c) => c.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("нажми Start");
  });
});
