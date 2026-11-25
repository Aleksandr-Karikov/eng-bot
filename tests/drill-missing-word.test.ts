import { describe, expect, it } from "vitest";
import { candidateWords, missingFrom } from "../src/services/rare-word";

/**
 * Баг #26: «мне нужно было подобрать слово, которое больше всего подходит к слову overcome,
 * но оказалось, что подходящее слово вообще мной не изучено».
 *
 * Слово оказывалось незнакомым не потому, что редкое в языке, а потому, что его **нет у человека**.
 * Поэтому проверяем словарь, а не частотность: на пяти живых вопросах частотный порог не нашёл
 * ничего (модель составляет вопросы из обиходных слов), а проверка по карточкам находит сразу.
 *
 * Первая попытка просить незнакомое слово у модели полем `new_word` тоже не сработала: два живых
 * прогона на разных профилях — ни одного названного слова. Просить легко, проверять нечем.
 */
describe("#26: незнакомое слово — то, которого нет в словаре", () => {
  it("берёт слова предложения без служебных", () => {
    expect(candidateWords("She managed to overcome ___ despite the difficult circumstances."))
      .toEqual(["managed", "overcome", "despite", "difficult", "circumstances"]);
  });

  it("не предлагает варианты ответа — они и так перед глазами", () => {
    const words = candidateWords("She managed to overcome ___.", ["obstacles", "hardships", "troubles"]);
    expect(words).not.toContain("obstacles");
    expect(words).toContain("managed");
  });

  it("находит слово, которого нет в словаре человека", () => {
    // У человека есть overcome и difficult, но нет circumstances.
    const known = ["overcome", "difficult", "she", "despite"];
    expect(missingFrom(known, "She managed to overcome ___ despite the difficult circumstances.")).toBe("managed");
    // Убрали managed из предложения — следующим недостающим станет circumstances.
    expect(missingFrom([...known, "managed"], "She managed to overcome ___ despite the difficult circumstances."))
      .toBe("circumstances");
  });

  it("учитывает формы слова: знает «face» — не предлагает «faced»", () => {
    expect(missingFrom(["face"], "The team faced many problems.")).toBe("team");
    expect(missingFrom(["manage"], "She managed to win.")).toBeUndefined();
  });

  it("фраза в словаре покрывает свои слова", () => {
    // «take for granted» в словаре — отдельные слова фразы тоже считаются знакомыми.
    expect(missingFrom(["take for granted"], "We take it for granted.")).toBeUndefined();
  });

  it("если всё знакомо — ничего не предлагает", () => {
    expect(missingFrom(["team", "face", "problem"], "The team faced a problem.")).toBeUndefined();
  });

  it("находит слово из жалобы, когда его нет в словаре", () => {
    // Словарь человека: слова из вопроса есть, а circumstances — нет.
    const known = ["overcome", "despite", "difficult", "manage"];
    const found = missingFrom(known, "She managed to overcome ___ despite the difficult circumstances.");
    expect(found).toBe("circumstances");
  });
});
