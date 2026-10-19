import type { FrequencySource } from "../frequency/frequency";
import type { PhraseFrequency, Register, Sense } from "../llm/enricher";

/** Границы по Zipf для отдельных слов: от 4.2 — очень частое, от 3.3 — встречается, ниже — редкое. */
export const ZIPF_HIGH = 4.2;
export const ZIPF_MEDIUM = 3.3;

export interface Rated {
  term: string;
  sense?: Sense;
  register?: Register;
  phraseFrequency?: PhraseFrequency;
  usefulness?: number | null;
  usefulnessNote?: string;
}

/** Отдельное слово (не фраза): частотность для него осмысленна. «to ensure» — тоже слово. */
export function singleWord(term: string): string | undefined {
  const word = term.trim().toLowerCase().replace(/^to\s+/, "");
  // Через дефис (over-deliver) wordfreq считает как два слова — это уже фраза.
  return /^[a-z][a-z']*$/.test(word.replace(/’/g, "'")) ? word.replace(/’/g, "'") : undefined;
}

/** Предлоги и частицы фразовых глаголов: «beset by», «draw up» — по сути одно слово с хвостиком. */
const PARTICLES = new Set(["by", "up", "down", "off", "out", "in", "on", "of", "with", "to", "about", "over", "away", "back", "around", "into", "for"]);

/** Главное слово фразы «слово + предлог/частица»; для прочих фраз — undefined. */
export function headWord(term: string): string | undefined {
  const parts = term.trim().toLowerCase().replace(/^to\s+/, "").split(/\s+/);
  return parts.length === 2 && PARTICLES.has(parts[1]) ? singleWord(parts[0]) : undefined;
}

export function levelByZipf(zipf: number): 1 | 2 | 3 {
  return zipf >= ZIPF_HIGH ? 3 : zipf >= ZIPF_MEDIUM ? 2 : 1;
}

const PHRASE_LEVEL: Record<PhraseFrequency, 1 | 2 | 3> = { common: 3, occasional: 2, rare: 1 };
const WORD_REASON = { 3: "частое слово", 2: "встречается", 1: "редкое слово" } as const;
const PHRASE_REASON = { 3: "частое выражение", 2: "встречается иногда", 1: "редкое выражение" } as const;
const REGISTER_REASON: Partial<Record<Register, string>> = {
  informal: "разговорное",
  formal: "книжное",
  rude: "грубое",
  dated: "устаревшее",
  niche: "узкий жаргон",
};

/**
 * Полезность по правилам, а не «по ощущению» модели — поэтому одинаковая, как бы слово ни добавили:
 * — база: у отдельного слова частотность (wordfreq), у фразы — корзина от модели по образцам;
 * — значение: не основное — не выше 🟡, редкое — ⚪️ (частотность слова значения не различает: divine ≠ «восхитительно»);
 * — регистр: грубое, устаревшее, жаргон — ⚪️, книжное — не выше 🟡.
 * Нет ни частотности, ни корзины — слово остаётся без оценки.
 */
export function scoreUsefulness(
  item: Rated,
  zipf: number | undefined,
  /** Частотность главного слова фразы «слово + частица»: фраза не полезнее своего слова (beset by — как beset). */
  headZipf?: number,
): { usefulness: number; usefulnessNote: string } | undefined {
  const word = singleWord(item.term);
  let level: number;
  const reasons: string[] = [];
  if (word && zipf) {
    level = levelByZipf(zipf);
    reasons.push(WORD_REASON[level as 1 | 2 | 3]);
  } else if (item.phraseFrequency) {
    level = PHRASE_LEVEL[item.phraseFrequency];
    if (headZipf && levelByZipf(headZipf) < level) {
      level = levelByZipf(headZipf);
      reasons.push(`${WORD_REASON[level as 1 | 2 | 3]} в основе`);
    } else {
      reasons.push(PHRASE_REASON[level as 1 | 2 | 3]);
    }
  } else {
    return undefined;
  }
  if (item.sense === "secondary" && level > 2) {
    level = 2;
    reasons.push("но значение не основное");
  } else if (item.sense === "rare" && level > 1) {
    level = 1;
    reasons.push("но это значение редкое");
  }
  const register = item.register ? REGISTER_REASON[item.register] : undefined;
  if (item.register === "rude" || item.register === "dated" || item.register === "niche") level = 1;
  else if (item.register === "formal") level = Math.min(level, 2);
  if (register) reasons.push(register);
  return { usefulness: level, usefulnessNote: reasons.join(" · ") };
}

/** Считает полезность для пачки слов: частотность — одним запросом к wordfreq. Без оценки — остаётся как было. */
export async function rateUsefulness<T extends Rated>(items: T[], frequency: FrequencySource | undefined): Promise<T[]> {
  const words = [...new Set(items.flatMap((i) => [singleWord(i.term), headWord(i.term)]).filter((w): w is string => Boolean(w)))];
  let zipf = new Map<string, number>();
  if (frequency && words.length) {
    try {
      zipf = await frequency.zipf(words);
    } catch (err) {
      console.error("Word frequency failed", err);
    }
  }
  return items.map((item) => {
    const word = singleWord(item.term);
    const head = headWord(item.term);
    const score = scoreUsefulness(item, word ? zipf.get(word) : undefined, head ? zipf.get(head) : undefined);
    return score ? { ...item, ...score } : item;
  });
}
