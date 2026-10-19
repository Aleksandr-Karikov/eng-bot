import type { FrequencySource } from "../frequency/frequency";

/** Границы по Zipf для отдельных слов: от 4.2 — очень частое, от 3.3 — встречается, ниже — редкое. */
export const ZIPF_HIGH = 4.2;
export const ZIPF_MEDIUM = 3.3;

const FREQUENCY_NOTES: Record<number, string> = {
  3: "очень частое слово",
  2: "встречается, но не на каждом шагу",
  1: "редкое слово — достаточно узнавать",
};

export interface Rated {
  term: string;
  usefulness?: number | null;
  usefulnessNote?: string;
  /** Модель отметила: грубое, устаревшее или жаргон одного сериала — самому употреблять незачем. */
  niche?: boolean;
}

/** Отдельное слово (не фраза): частотность для него осмысленна. «to ensure» — тоже слово. */
export function singleWord(term: string): string | undefined {
  const word = term.trim().toLowerCase().replace(/^to\s+/, "");
  // Через дефис (over-deliver) wordfreq считает как два слова — это уже фраза.
  return /^[a-z][a-z'’]*$/.test(word) ? word : undefined;
}

export function levelByZipf(zipf: number): 1 | 2 | 3 {
  return zipf >= ZIPF_HIGH ? 3 : zipf >= ZIPF_MEDIUM ? 2 : 1;
}

/**
 * Полезность отдельных слов — по частотности, а не по настроению модели: иначе одно и то же слово
 * при /add выходило «очень полезным», а в списке со скриншота — «полезным». Фразы и идиомы оценивает модель.
 * Грубое и устаревшее — всегда необязательное.
 */
export async function applyFrequency<T extends Rated>(items: T[], frequency: FrequencySource | undefined): Promise<T[]> {
  const result = items.map((item) => (item.niche ? { ...item, usefulness: 1 } : item));
  if (!frequency) return result;
  const words = [...new Set(result.filter((i) => !i.niche).map((i) => singleWord(i.term)).filter((w): w is string => Boolean(w)))];
  let zipf: Map<string, number>;
  try {
    zipf = await frequency.zipf(words);
  } catch (err) {
    console.error("Word frequency failed", err);
    return result;
  }
  return result.map((item) => {
    const word = singleWord(item.term);
    const z = word && !item.niche ? zipf.get(word) : undefined;
    if (z === undefined || z === 0) return item;
    const level = levelByZipf(z);
    // Пояснение модели оставляем, если она пришла к тому же уровню, — оно содержательнее шаблона.
    return { ...item, usefulness: level, usefulnessNote: item.usefulness === level && item.usefulnessNote ? item.usefulnessNote : FREQUENCY_NOTES[level] };
  });
}
