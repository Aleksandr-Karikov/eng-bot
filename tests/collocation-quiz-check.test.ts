import { describe, expect, it } from "vitest";
import { buildQuizCheckPrompt, parseQuizCheck } from "../src/llm/tutor";
import { validQuiz } from "../src/services/collocations";

/**
 * Баг #20: в вопросе на сочетания не было правильного варианта.
 *
 * Человек получил вопрос «This new video game is so ___ that I can't stop playing» с вариантами
 * `highly / addictive / behavior`. Верным по базе стояло `highly`, и подстановка давала бессмыслицу:
 * «so **highly** that I can't stop playing». Правильного варианта (`addictive`) в списке не было вовсе.
 *
 * Причина: у вопросов на сочетания проверялся только формат — `correct` не вылезает за массив.
 * У вопросов по ошибкам (`drill`) самопроверка была, у сочетаний — нет. Теперь есть: модель
 * подставляет каждый вариант и читает предложение целиком.
 */
describe("#20: вопрос на сочетания проходит самопроверку", () => {
  it("промпт требует подставить каждый вариант и прочитать всё предложение", () => {
    const p = buildQuizCheckPrompt({
      term: "addictive",
      question: "This new video game is so ___ that I can't stop playing.",
      options: ["highly", "addictive", "behavior"],
      correct: 0,
      explanation: "«highly addictive» — сильное сочетание",
    }, "вызывающий привыкание");
    // Варианты и мнение автора — в промпте, иначе проверять нечего.
    expect(p).toContain("highly");
    expect(p).toContain("addictive");
    expect(p).toContain("behavior");
    expect(p).toContain('По мнению автора верный — 0');
    expect(p).toContain("вариант, который автор считает верным");
    // Отдельно: ответ должен быть соседним словом, а не самим словом.
    expect(p).toMatch(/соседнее слово/);
    // И главное: разная естественность вариантов — не повод отбрасывать вопрос. Без этой оговорки
    // проверка отбрасывала 91 вопрос из 151, включая годные (sink into despair / sink in despair).
    expect(p).toMatch(/Разная степень идиоматичности НЕ делает вопрос негодным/);
  });

  it("разбор ответа проверки: негодный вопрос отклоняется с причиной", () => {
    expect(parseQuizCheck(JSON.stringify({ ok: false, why: "«so highly» не согласуется" })))
      .toEqual({ ok: false, why: "«so highly» не согласуется" });
    expect(parseQuizCheck(JSON.stringify({ ok: true }))).toEqual({ ok: true, why: "" });
    // Не разобрали ответ — вопрос остаётся: лучше показать, чем молча потерять.
    expect(parseQuizCheck("не json").ok).toBe(true);
  });

  it("существующая проверка формата всё ещё отбрасывает ответ-часть слова", () => {
    // Это старая защита (validQuiz), она про другое: ответ не должен быть самим словом.
    const quiz = {
      question: "The film really ___ me in from the first minute.",
      options: ["pulled", "took", "caught"],
      correct: 0,
      explanation: "",
    };
    expect(validQuiz(quiz, "pull someone in")).toBe(false);
    expect(validQuiz({ ...quiz, options: ["approach", "way", "method"], question: "It would be a prudent ___ to wait." }, "prudent")).toBe(true);
  });
});
