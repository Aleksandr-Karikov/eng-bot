import { describe, expect, it } from "vitest";
import type { FrequencySource } from "../src/frequency/frequency";
import { phraseWords, rarestOf, rateUsefulness, singleWord } from "../src/services/usefulness";

/**
 * Баг #17: «не у всех слов и фраз есть значок полезности».
 *
 * На проде из 1077 слов 14 оставались без оценки, и ни одно не было случайным: дефисные слова
 * (`heads-up`, `low-key`, `well-intentioned`, `self-proclaimed`), фразы без частицы (`making it`,
 * `self expression`, `be fired`) и опечатки, которых нет в корпусах (`anxietry`, `manifique`).
 *
 * Причин было две:
 * 1. `singleWord()` считал словом только `[a-z']`, а `wordfreq` прекрасно знает дефисные слова —
 *    `heads-up` 4.66, `low-key` 4.91. Комментарий «wordfreq считает дефис как два слова» оказался
 *    неверным: он даёт `over-deliver` 4.54 и `over deliver` 4.54 — одно и то же, то есть дефис для
 *    него пробел, но частотность при этом честная, а не сумма частей.
 * 2. Частотность проверялась на истинность (`if (word && zipf)`), поэтому `zipf === 0` — «слова нет
 *    ни в одном корпусе» — читался как «данных нет» и оставлял слово без оценки.
 *
 * Частотность в тестах — подмена, а не настоящий Python: гейт не должен зависеть от wordfreq.
 * Значения взяты настоящие, снятые с прода (см. журнал E36/E37).
 */
const FREQ: Record<string, number> = {
  "heads-up": 4.66, "low-key": 4.91, "high-key": 5.03, "well-intentioned": 2.91, "self-proclaimed": 3.76,
  "over-deliver": 4.54, anxietry: 0, manifique: 0,
  making: 5.54, it: 6.95, self: 5.25, expression: 4.55, be: 6.79, fired: 4.63,
  favor: 4.58, commandments: 3.4, "steady-handed": 4.06,
  trump: 4.93, the: 7.73, kipper: 2.32, up: 6.39, out: 6.38, wiped: 3.86,
};
const source: FrequencySource = { zipf: async (terms) => new Map(terms.map((t) => [t, FREQ[t] ?? 0])) };

const rated = async (term: string) => (await rateUsefulness([{ term }], source))[0];

describe("#17: у каждого слова есть оценка", () => {
  it("дефисное слово — это слово, и wordfreq его знает", async () => {
    expect(singleWord("heads-up")).toBe("heads-up");
    expect(singleWord("well-intentioned")).toBe("well-intentioned");
    // Настоящие оценки с прода: частое — 🟢, редкое — 🟡.
    expect(await rated("heads-up")).toMatchObject({ usefulness: 3 });
    expect(await rated("low-key")).toMatchObject({ usefulness: 3 });
    expect(await rated("well-intentioned")).toMatchObject({ usefulness: 1 });
  });

  it("фраза без частицы оценивается по самому редкому содержательному слову", async () => {
    // `making it` — 5.54 по making, `be fired` — 4.63 по fired.
    expect(await rated("making it")).toMatchObject({ usefulness: 3 });
    expect(await rated("be fired")).toMatchObject({ usefulness: 3 });
    expect(await rated("self expression")).toMatchObject({ usefulness: 3 });
  });

  it("выдуманная фраза не получает 🟢 за счёт обиходных слов", async () => {
    // По всей строке wordfreq дал бы 2.32, и это совпало бы с «настоящей» фразой. Нижнюю границу
    // даёт редкое слово: `kipper` — 2.32, значит ⚪️. Так правило не зависит от того, есть ли фраза.
    expect(await rated("trump the kipper")).toMatchObject({ usefulness: 1 });
  });

  it("слова нет ни в одном корпусе — это ⚪️, а не пустая оценка", async () => {
    // Опечатка в самом слове: человек ввёл «anxietry» вместо «anxiety».
    expect(await rated("anxietry")).toMatchObject({ usefulness: 1 });
    expect(await rated("manifique")).toMatchObject({ usefulness: 1 });
    // Слово есть в базе и знакомо — оценка по частоте.
    expect(await rated("favor")).toMatchObject({ usefulness: 3 });
  });

  it("частицы не участвуют в минимуме: иначе «wiped out» тянуло бы вниз служебное слово", () => {
    // `out` (6.38) — не то, что делает фразу редкой; решает главное слово в самой частой форме.
    expect(phraseWords("wiped out")).toEqual(["wiped", "out"]);
    const zipf = new Map(Object.entries(FREQ));
    expect(rarestOf("wiped out", zipf)).toEqual({ word: "wiped", zipf: 3.86 });
    expect(rarestOf("heads-up", zipf)).toEqual({ word: "heads-up", zipf: 4.66 });
    // Фраза целиком из незнакомых слов — оценивать нечем, но и «пустоты» не будет: слово не из корпусов.
    expect(rarestOf("qqq zzz", new Map())).toBeUndefined();
  });
});
