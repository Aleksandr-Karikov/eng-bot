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

/**
 * Отдельное слово (не фраза): частотность для него осмысленна. «to ensure» — тоже слово.
 *
 * Дефисное слово — тоже слово, и wordfreq его знает: `heads-up` 4.66, `low-key` 4.91,
 * `well-intentioned` 2.91. Раньше здесь стояло `[a-z']`, и все дефисные слова оставались без оценки
 * (баг #17): `wordfreq` действительно считает дефис как пробел (`over-deliver` и `over deliver` дают
 * одно и то же), но это не мешает — частотность у такой «фразы из двух частей» честная и осмысленная,
 * а не сумма двух частей.
 */
export function singleWord(term: string): string | undefined {
  // Корейское слово — одно, если без пробелов (사랑, 먹다).
  if (/^[\uac00-\ud7a3]+$/.test(term.trim())) return term.trim();
  const word = term.trim().toLowerCase().replace(/^to\s+/, "").replace(/’/g, "'");
  return /^[a-z][a-z'-]*$/.test(word) ? word : undefined;
}

/** Предлоги и частицы фразовых глаголов: «beset by», «draw up» — по сути одно слово с хвостиком. */
const PARTICLES = new Set(["by", "up", "down", "off", "out", "in", "on", "of", "with", "to", "about", "over", "away", "back", "around", "into", "for"]);

/** Главное слово фразы «слово + предлог/частица»; для прочих фраз — undefined. */
export function headWord(term: string): string | undefined {
  const parts = term.trim().toLowerCase().replace(/^to\s+/, "").split(/\s+/);
  return parts.length === 2 && PARTICLES.has(parts[1]) ? singleWord(parts[0]) : undefined;
}

/**
 * Слова, из которых состоит фраза, — по ним видно, бывает ли она в текстах вообще.
 *
 * Нужно для фраз, которых не покрывают `singleWord` (одно слово) и `headWord` (слово + частица):
 * `making it`, `self expression`, `be fired`, `pull someone in`. У них не было никакой оценки — ни от
 * частотности, ни от модели, если та не дала корзину (`phraseFrequency`), — и слово оставалось без
 * значка (баг #17).
 */
export function phraseWords(term: string): string[] {
  return term
    .trim()
    .toLowerCase()
    .replace(/^to\s+/, "")
    .split(/[^a-z'-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length >= 2 && /[a-z]/.test(w));
}


/**
 * Возможные исходные формы слова: фразы часто записаны в изменённой форме (wiped out, drawing up, running late),
 * а частотность конкретной формы ниже, чем у слова вообще. wordfreq форм не объединяет — перебираем сами.
 */
export function baseForms(word: string): string[] {
  const forms = new Set([word]);
  const add = (w: string) => w.length >= 2 && forms.add(w);
  for (const [suffix, repl] of [["ies", "y"], ["ied", "y"], ["es", ""], ["s", ""], ["ed", ""], ["ed", "e"], ["d", ""], ["ing", ""], ["ing", "e"]] as const) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem + repl);
    // Удвоенная согласная: running → run, spinning → spin.
    if (!repl && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
  }
  return [...forms];
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
  /** Самое редкое содержательное слово фразы: фраза не полезнее своей самой редкой части (баг #17). */
  rarest?: { word: string; zipf: number },
): { usefulness: number; usefulnessNote: string } | undefined {
  const word = singleWord(item.term);
  let level: number;
  const reasons: string[] = [];
  if (word && zipf !== undefined) {
    // zipf === 0 — слова нет ни в одном корпусе (опечатка, выдуманное слово): это ⚪️, а не «нет данных».
    // Раньше `zipf` проверялся на истинность, и такие слова оставались без значка (баг #17).
    level = levelByZipf(zipf);
    reasons.push(WORD_REASON[level as 1 | 2 | 3]);
  } else if (item.phraseFrequency) {
    level = PHRASE_LEVEL[item.phraseFrequency];
    // Фраза не полезнее своих частей. У «слово + частица» решает главное слово в самой частой форме
    // (wiped out → wipe, а не wiped): частица служебная, и в минимуме она бесполезна. У прочих фраз
    // главного слова нет, и нижнюю границу даёт самое редкое содержательное слово.
    const head = headWord(item.term);
    const cap = head !== undefined
      ? (headZipf !== undefined && levelByZipf(headZipf) < level
          ? { zipf: headZipf, reason: `само «${head}» — ${WORD_REASON[levelByZipf(headZipf)]}` }
          : undefined)
      : (rarest && levelByZipf(rarest.zipf) < level
          ? { zipf: rarest.zipf, reason: `«${rarest.word}» — ${WORD_REASON[levelByZipf(rarest.zipf)]}` }
          : undefined);
    if (cap) {
      level = levelByZipf(cap.zipf);
      reasons.push(cap.reason);
    } else {
      reasons.push(PHRASE_REASON[level as 1 | 2 | 3]);
    }
  } else if (word === undefined && rarest) {
    // Модель корзину не дала — судим по самому редкому слову фразы. Не по частотности всей строки:
    // `wordfreq` считает её по самым частым словам («the the the» → 7.25), и выдуманная фраза из
    // обиходных слов получила бы 🟢. Самое редкое слово — честная нижняя граница (баг #17).
    level = levelByZipf(rarest.zipf);
    reasons.push(`«${rarest.word}» — ${WORD_REASON[level as 1 | 2 | 3]}`);
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

/**
 * Самое редкое содержательное слово фразы: нижняя граница её полезности.
 *
 * Частицы (`up`, `by`, `in`, `off`) пропускаем намеренно: это самые частые слова языка, и в минимуме
 * они бесполезны — фразу оценивают по содержательным словам (`wiped out` — по `wiped`, а не по `out`,
 * иначе тестовая подмена частотности с её нулями тянула бы оценку вниз).
 *
 * `undefined` — фразу не из чего оценивать: все её слова незнакомы, и это не «редкое», а «неизвестное».
 */
export function rarestOf(term: string, zipf: Map<string, number>): { word: string; zipf: number } | undefined {
  const parts = phraseWords(term).filter((w) => !PARTICLES.has(w));
  if (parts.length === 0) return undefined;
  // Каждое слово — в самой частой своей форме, как и главное слово фразового глагола (wiped out → wipe):
  // у формы прошедшего времени частотность занижена сама по себе, и «hopped up» не должен считаться
  // редким из-за «hopped» при том, что «hop» — частое.
  const candidates = parts
    .map((p) => {
      const forms = baseForms(p).map((f) => zipf.get(f)).filter((z): z is number => z !== undefined);
      return forms.length ? { word: p, zipf: Math.max(...forms) } : undefined;
    })
    .filter((c): c is { word: string; zipf: number } => c !== undefined);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((a, b) => (a.zipf <= b.zipf ? a : b));
}

/** Считает полезность для пачки слов: частотность — одним запросом к wordfreq. Без оценки — остаётся как было. */
export async function rateUsefulness<T extends Rated>(items: T[], frequency: FrequencySource | undefined): Promise<T[]> {
  const heads = items.map((i) => headWord(i.term)).filter((w): w is string => Boolean(w));
  const words = [...new Set([
    ...items.map((i) => singleWord(i.term)).filter((w): w is string => Boolean(w)),
    ...heads.flatMap(baseForms),
    ...items.flatMap((i) => phraseWords(i.term)).flatMap(baseForms),
  ])];
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
    const headZipf = head ? Math.max(0, ...baseForms(head).map((f) => zipf.get(f) ?? 0)) : undefined;
    const score = scoreUsefulness(item, word ? zipf.get(word) : undefined, headZipf || undefined, rarestOf(item.term, zipf));
    return score ? { ...item, ...score } : item;
  });
}
