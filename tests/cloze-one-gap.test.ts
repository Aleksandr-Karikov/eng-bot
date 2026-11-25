import { describe, expect, it } from "vitest";
import { fillGap, gapParts } from "../src/bot/texts";
import { gapsIn, validCloze } from "../src/services/cloze";
import { parseCloze } from "../src/llm/tutor";

/**
 * Баг #25: «странное задание — The past seems to have hold_ a strong ____ on him».
 *
 * Две разные поломки, обе на проде:
 *
 * 1. **Модель ставит два пропуска** на фразу из нескольких слов: `____ a strong ____` при ответе
 *    `have hold`, `___ ___` при `apex predator`. Разбор подставляет ответ в единственный пропуск,
 *    и второй остаётся в тексте пустым — человек видит «ответ не заполняет оба пропуска».
 *    Такие предложения нужно отбрасывать при разборе ответа модели и при сохранении.
 *
 * 2. **Разбор резал ровно по трём подчёркиваниям.** Модель пишет и `_______` (семь штук) —
 *    после подстановки оставалось лишнее `____`: «I love adding **pickled onions**____ to my
 *    cheese board». Теперь пропуском считается любой ряд из трёх и более подчёркиваний.
 */
describe("#25: в задании ровно один пропуск", () => {
  it("предложение с двумя пропусками отбрасывается, с одним — остаётся", () => {
    // Настоящие записи с прода.
    const two = [
      "The past seems to ____ a strong ____ on him.",
      "In the corporate world, she was known as an ___ ___.",
      "I'd be grateful if you could ___ this small ___ for me.",
    ];
    for (const s of two) expect(validCloze(s), s).toBe(false);
    expect(validCloze("We sat on the ___ of the river.")).toBe(true);
    expect(validCloze("I love adding _______ to my cheese board.")).toBe(true);
    expect(gapsIn("The past seems to ____ a strong ____ on him.")).toHaveLength(2);
  });

  it("parseCloze выбрасывает такие предложения, а не сохраняет их", () => {
    const raw = JSON.stringify([
      { sentence: "The past seems to ____ a strong ____ on him.", answer: "have hold", translation: "x" },
      { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу." },
    ]);
    expect(parseCloze(raw)).toEqual([
      { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "Мы сидели на берегу." },
    ]);
  });

  it("пропуск любой длины подставляется целиком, без остатка подчёркиваний", () => {
    // Семь подчёркиваний — так модель и написала; раньше оставалось «____».
    expect(gapParts("I love adding _______ to my board.", "pickled onions")).toEqual({
      before: "I love adding ",
      answer: "pickled onions",
      after: " to my board.",
    });
    expect(fillGap("I love adding _______ to my board.", "pickled onions")).toBe("I love adding <b>pickled onions</b> to my board.");
    // Обычные три подчёркивания работают как раньше.
    expect(fillGap("We sat on the ___ of the river.", "bank")).toBe("We sat on the <b>bank</b> of the river.");
  });

  it("повтор слова на стыке убирается и при длинном пропуске", () => {
    expect(fillGap("We need _______ gold for this ring.", "gold")).toBe("We need <b>gold</b> for this ring.");
    expect(fillGap("Pass me _______ salt, please.", "the salt")).toBe("Pass me <b>the salt</b>, please.");
  });
});
