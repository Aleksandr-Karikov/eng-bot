import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { botHarness, settle } from "./bot-harness";
import { T0, makeUser } from "./helpers";
import { saveWord } from "../src/services/words";
import { ensurePersonalRoom } from "../src/services/rooms";
import { findInlineWords, INLINE_LIMIT, INLINE_MIN_CHARS } from "../src/services/inline";
import { checkAndCount, QUOTAS, quotaUsed } from "../src/services/limits";
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

interface InlineCard {
  title: string;
  description: string;
  input_message_content: { message_text: string };
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

const lastInline = (h: ReturnType<typeof botHarness>) => {
  const call = [...h.calls].reverse().find((c) => c.method === "answerInlineQuery");
  return call?.payload as { results?: InlineCard[] } | undefined;
};

const titles = (h: ReturnType<typeof botHarness>) => lastInline(h)?.results?.map((r) => r.title) ?? [];

/** Тексты всплывашек `answerCallbackQuery` — по ним видно, что человек увидел сразу. */
const texts = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));

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

    // Перевод уходит в фон (см. `background`), поэтому ждём его, а не проверяем сразу.
    await vi.waitFor(() => expect(calls).toEqual(["ubiquitous"]));
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
    await vi.waitFor(() => expect(calls).toEqual(["set off"]));

    calls.length = 0;
    await h.bot.handleUpdate(h.inlineQuery(100, "это целое предложение из многих слов, его переводить не надо"));
    expect(calls).toEqual([]);
  });

  it("после лимита переводов модель больше не зовут", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });
    const user = await makeUser(h.db, 100);

    // Лимит выбираем напрямую, а не тридцатью инлайн-запросами: каждый запрос теперь ждёт паузу
    // против набора по буквам, и тест стоил бы полминуты вместо проверки того же самого.
    for (let i = 0; i < QUOTAS.inline_translate.limit; i++) {
      await checkAndCount(h.db, { userId: user.id, kind: "inline_translate", timeZone: "Europe/Moscow", now: T0 });
    }

    await h.bot.handleUpdate(h.inlineQuery(100, "ubiquitous"));

    // Отказ виден по пустому ответу: ждать нечего, но убедимся, что модель так и не позвали.
    await vi.waitFor(async () => {
      const used = await quotaUsed(h.db, { userId: user.id, kind: "inline_translate", timeZone: "Europe/Moscow", now: T0 });
      expect(used).toBe(QUOTAS.inline_translate.limit);
    });
    expect(calls).toEqual([]);
    const used = await quotaUsed(h.db, { userId: user.id, kind: "inline_translate", timeZone: "Europe/Moscow", now: T0 });
    expect(used).toBe(QUOTAS.inline_translate.limit);
  });

  it("набор по буквам не тратит лимит на каждую букву: отвечает только последний запрос", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });
    const user = await makeUser(h.db, 100);

    // Человек печатает «serendipity» — Telegram шлёт запрос на каждую букву. Запросы приходят
    // с интервалом меньше паузы, поэтому ни один из них не должен дойти до модели: платить нужно
    // один раз, за то, что человек набрал в итоге.
    await h.bot.handleUpdate(h.inlineQuery(100, "ser"));
    vi.setSystemTime(Date.now() + 200);
    await h.bot.handleUpdate(h.inlineQuery(100, "sere"));
    vi.setSystemTime(Date.now() + 200);
    await h.bot.handleUpdate(h.inlineQuery(100, "seren"));

    expect(calls).toEqual([]);

    // Человек перестал печатать — пауза истекает, и переводится последний набранный запрос.
    vi.setSystemTime(Date.now() + 700);
    await vi.waitFor(() => expect(calls).toEqual(["seren"]));
    expect(calls).toHaveLength(1);
    const used = await quotaUsed(h.db, { userId: user.id, kind: "inline_translate", timeZone: "Europe/Moscow", now: T0 });
    expect(used).toBe(1);

    vi.useRealTimers();
  });

  it("набранное слово не оплачивается, если человек стёр его и выбрал то, что есть в словаре", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });
    await withWords(h, 100, [["gauge", "датчик"]]);

    // «xyz» нет в словарях, но человек стёр его раньше, чем истекла пауза, и набрал слово, которое
    // в словаре есть. Перевод «xyz» оплачивать не за что: ответ на него Telegram уже не покажет.
    await h.bot.handleUpdate(h.inlineQuery(100, "xyz"));
    vi.setSystemTime(Date.now() + 700);
    await h.bot.handleUpdate(h.inlineQuery(100, "gauge"));

    await settle(50);
    vi.setSystemTime(Date.now() + 700);
    await settle(50);

    expect(calls).toEqual([]);
    vi.useRealTimers();
  });

  it("брошенная попытка не отвечает задним числом на чужой запрос", async () => {
    const calls: string[] = [];
    const h = botHarness({ enricher: fastEnricher(calls) });

    // Человек набрал слово и передумал, не дождавшись паузы. Вторая попытка приходит, пока первая ещё
    // «висит» в `setTimeout`. Перевестись должно ровно одно слово — то, что человек набрал в итоге.
    await h.bot.handleUpdate(h.inlineQuery(100, "ubiquitous"));
    await settle(200);
    await h.bot.handleUpdate(h.inlineQuery(100, "gauge"));

    await vi.waitFor(() => expect(titles(h)).toEqual(["gauge"]));
    expect(calls).toEqual(["gauge"]);
  });

  it("кнопка «Добавить в словарь» кладёт слово в личный словарь", async () => {
    const h = botHarness({ enricher: fastEnricher([]) });
    const user = await makeUser(h.db, 100);

    await h.bot.handleUpdate(h.callback(100, "in:ubiquitous"));

    await vi.waitFor(async () => expect(await findInlineWords(h.db, user.id, "ubiquitous")).toHaveLength(1));
    const hits = await findInlineWords(h.db, user.id, "ubiquitous");
    expect(hits[0].word.translation).toBe("вездесущий");
  });

  it("нажатие кнопки не ждёт модель: бот отвечает сразу, а перевод идёт в фоне", async () => {
    // Модель, которая «висит», пока тест не разрешит: так видно, кто кого ждёт.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enrich = vi.fn(async () => {
      await gate;
      return { translation: "вездесущий", explanation: "", example: "" };
    });
    const h = botHarness({ enricher: { ...fastEnricher([]), enrich } });
    const user = await makeUser(h.db, 100);

    // Апдейт обязан завершиться, хотя перевод ещё не готов: `enrich` — это до 30 секунд, и апдейты
    // обрабатываются по одному, поэтому ожидание внутри обработчика заморозило бы бота для всех.
    await h.bot.handleUpdate(h.callback(100, "in:ubiquitous"));

    expect(enrich).toHaveBeenCalledWith("ubiquitous");
    expect(texts(h)).toContain("Добавляю…");
    expect(await findInlineWords(h.db, user.id, "ubiquitous")).toHaveLength(0);

    // Отпускаем модель — слово доезжает до словаря уже в фоне.
    release();
    await vi.waitFor(async () => expect(await findInlineWords(h.db, user.id, "ubiquitous")).toHaveLength(1));
  });

  it("слишком длинная фраза показывается без кнопки: в словарь ушёл бы обрезанный кусок", async () => {
    // 51 байт — в callback-данные (48) не влезает, и `encodeCb` обрезал бы термин молча.
    // Корейский здесь не для экзотики: это изучаемый язык (`lang=ko`), и на нём довольно быстро
    // набирается слово, которому кнопки уже не хватает.
    const long = "고생끝에낙이온다지만그래도힘들었다";
    expect(Buffer.byteLength(long, "utf8")).toBeGreaterThan(48);
    // Заодно фиксируем, что фраза проходит `looksLikeWord`: переводить её можно, а кнопки не будет.
    expect(long.length).toBeLessThanOrEqual(60);
    const h = botHarness({ enricher: fastEnricher([], "после страданий приходит радость") });

    await h.bot.handleUpdate(h.inlineQuery(100, long));
    await vi.waitFor(() => expect(lastInline(h)?.results ?? []).toHaveLength(1));

    const card = lastInline(h)!.results![0];
    expect(card.title).toBe(long);
    expect(card.input_message_content.message_text).toContain("после страданий приходит радость");
    // Кнопки нет — значит нет и способа сохранить обрезанное слово.
    expect(card.reply_markup).toBeUndefined();
  });

  it("короткий термин кнопку получает: обрезать нечего", async () => {
    const h = botHarness({ enricher: fastEnricher([]) });

    await h.bot.handleUpdate(h.inlineQuery(100, "ubiquitous"));
    await vi.waitFor(() => expect(lastInline(h)?.results ?? []).toHaveLength(1));

    const button = lastInline(h)!.results![0].reply_markup?.inline_keyboard[0][0];
    expect(button?.callback_data).toBe("in:ubiquitous");
    // Данные кнопки влезают в лимит Telegram и не обрезаны.
    expect(Buffer.byteLength(button!.callback_data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("кнопка под инлайн-карточкой работает без чата — только inline_message_id", async () => {
    const h = botHarness({ enricher: fastEnricher([]) });
    const user = await makeUser(h.db, 100);

    // Настоящая форма нажатия под инлайн-карточкой: чата нет вообще, есть только `inline_message_id`.
    // Именно на ней ломался прежний обработчик, требовавший `ctx.chat`.
    await h.bot.handleUpdate(h.inlineCallback(100, "in:ubiquitous"));

    const hits = await findInlineWords(h.db, user.id, "ubiquitous");
    expect(hits).toHaveLength(1);
    // Подтверждение уходит в личку нажавшему, а не в чат: чата у этого апдейта не существует.
    const reply = [...h.calls].reverse().find((c) => c.method === "sendMessage");
    expect(reply?.payload.chat_id).toBe(100);
  });
});
