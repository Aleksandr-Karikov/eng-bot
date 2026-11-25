import { describe, expect, it } from "vitest";
import { fillGap, gapParts } from "../src/bot/texts";
import { answersOf, clozeMatches, gapCount, gapSegments, joinAnswers } from "../src/services/cloze";
import { isExactAnswer } from "../src/services/exercises";
import { parseCloze } from "../src/llm/tutor";

/**
 * Баг #25: «Ответ не заполняет оба пропуска».
 *
 * Задание бывает с двумя пропусками — когда фраза стоит в предложении порознь: «The past seems to
 * ___ a strong ___ on him» (have a hold on). Это нормальное задание, его надо **поддерживать**, а не
 * отбрасывать: человек заполняет каждый пропуск отдельно.
 *
 * Ответы хранятся одной строкой через `|` — `have|hold`. Разделитель, а не пробел: `do me a favor`
 * состоит из четырёх слов, и по словам не угадать, где кончается первый пропуск.
 */
describe("#25: задание с двумя пропусками", () => {
  it("считает пропуски и режет предложение на куски", () => {
    expect(gapCount("We sat on the ___ of the river.")).toBe(1);
    expect(gapSegments("We sat on the ___ of the river.")).toEqual(["We sat on the ", " of the river."]);
    expect(gapCount("The past seems to ____ a strong ____ on him.")).toBe(2);
    expect(gapSegments("The past seems to ____ a strong ____ on him.")).toEqual([
      "The past seems to ", " a strong ", " on him.",
    ]);
    // Модель пишет и семь подчёркиваний — это тот же пропуск.
    expect(gapCount("I love adding _______ to my board.")).toBe(1);
  });

  it("ответы хранятся через | и разбираются обратно", () => {
    expect(answersOf("have|hold")).toEqual(["have", "hold"]);
    expect(answersOf("do me|favor")).toEqual(["do me", "favor"]);
    // Один пропуск — как было, без разделителя: старые записи читаются без миграции.
    expect(answersOf("bank")).toEqual(["bank"]);
    expect(joinAnswers(["have", "hold"])).toBe("have|hold");
    expect(joinAnswers(["bank"])).toBe("bank");
  });

  it("число ответов должно совпадать с числом пропусков", () => {
    expect(clozeMatches("The past seems to ____ a strong ____ on him.", "have|hold")).toBe(true);
    // Именно это и было на проде: два пропуска, один ответ — задание нерешаемо.
    expect(clozeMatches("The past seems to ____ a strong ____ on him.", "have hold")).toBe(false);
    expect(clozeMatches("The past seems to ____ a strong ____ on him.", "have")).toBe(false);
    expect(clozeMatches("We sat on the ___ of the river.", "bank")).toBe(true);
  });

  it("parseCloze пропускает задание, где ответов столько же, сколько пропусков", () => {
    const raw = JSON.stringify([
      { sentence: "The past seems to ____ a strong ____ on him.", answer: "have|hold", translation: "x" },
      // Старый формат: два пропуска, один ответ — нерешаемо, отбрасываем.
      { sentence: "In the corporate world she was an ___ ___.", answer: "apex predator", translation: "y" },
      { sentence: "We sat on the ___ of the river.", answer: "bank", translation: "z" },
    ]);
    expect(parseCloze(raw).map((c) => c.answer)).toEqual(["have|hold", "bank"]);
  });

  it("показывает каждый ответ на своём пропуске", () => {
    expect(fillGap("The past seems to ____ a strong ____ on him.", "have|hold"))
      .toBe("The past seems to <b>have</b> a strong <b>hold</b> on him.");
    expect(fillGap("In the corporate world, she was known as an ___ ___.", "apex|predator"))
      .toBe("In the corporate world, she was known as an <b>apex</b> <b>predator</b>.");
    expect(fillGap("I'd be grateful if you could ___ this small ___ for me.", "do me|favor"))
      .toBe("I'd be grateful if you could <b>do me</b> this small <b>favor</b> for me.");
  });

  it("отдаёт куски и ответы по порядку — по ним приложение рисует поля ввода", () => {
    const p = gapParts("The past seems to ____ a strong ____ on him.", "have|hold");
    expect(p.parts).toEqual([
      { text: "The past seems to " },
      { answer: "have" },
      { text: " a strong " },
      { answer: "hold" },
      { text: " on him." },
    ]);
    // Для одного пропуска — прежние before/answer/after.
    const one = gapParts("We sat on the ___ of the river.", "bank");
    expect(one).toMatchObject({ before: "We sat on the ", answer: "bank", after: " of the river." });
  });

  it("повтор слова на стыке убирается и при двух пропусках", () => {
    expect(fillGap("We need ___ gold.", "the gold")).toBe("We need <b>the gold</b>.");
    expect(fillGap("Pass me ___ salt, please.", "the salt")).toBe("Pass me <b>the salt</b>, please.");
  });

  it("ответ принимается как с разделителем, так и подряд", () => {
    // В базе — `have|hold`, а человек пишет «have hold»: оба написания верны.
    const expected = { answer: "have|hold", term: "have a hold on" };
    expect(isExactAnswer("have hold", expected)).toBe(true);
    expect(isExactAnswer("have|hold", expected)).toBe(true);
    expect(isExactAnswer("have | hold", expected)).toBe(true);
    expect(isExactAnswer("have", expected)).toBe(false);
    expect(isExactAnswer("hold have", expected)).toBe(false);
    expect(isExactAnswer("have a hold on", expected)).toBe(false);
    expect(isExactAnswer("do|me favor", { answer: "do me|favor", term: "do me a favor" })).toBe(false);
  });
});
