import { describe, expect, it } from "vitest";
import { jsonArray, jsonObject } from "../src/llm/json";

/**
 * Ответ модели может оборваться: у OpenRouter есть потолок `max_tokens`, и на длинном `/text`
 * он упирался раньше, чем модель заканчивала массив. Раньше такой ответ терялся целиком —
 * человек видел «не получилось разобрать», хотя первые пункты были целы, а попытка уже списана (E27).
 */
describe("обрезанный ответ модели (E27)", () => {
  const twoWhole = '[{"term":"a","translation":"1"},{"term":"b","translation":"2"}';

  it("спасает целые объекты из обрезанного массива", () => {
    expect(jsonArray(twoWhole)).toEqual([
      { term: "a", translation: "1" },
      { term: "b", translation: "2" },
    ]);
  });

  it("спасает когда обрыв внутри третьего объекта", () => {
    const text = '[{"term":"a"},{"term":"b"},{"term":"c","transl';
    expect(jsonArray(text)).toEqual([{ term: "a" }, { term: "b" }]);
  });

  it("целый ответ разбирается как раньше, без спасения", () => {
    expect(jsonArray('[{"term":"a"},{"term":"b"}]')).toEqual([{ term: "a" }, { term: "b" }]);
  });

  it("обрезанный в первом же объекте — ошибка, спасать нечего", () => {
    // Целых объектов нет: лучше честная ошибка, чем пустой список, который выглядел бы как «слов нет».
    expect(() => jsonArray('[{"term":"a","transl')).toThrow(/No JSON/);
  });

  it("объект спасается так же: последняя закрытая скобка", () => {
    // jsonObject не обрезается посередине так же часто, но правило общее.
    expect(jsonObject('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
  });
});
