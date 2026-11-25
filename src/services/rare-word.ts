import { baseForms } from "./usefulness";
import { normalizeTerm } from "./words";

/** Служебные и самые обиходные слова: их знает любой, предлагать их нечего. */
const STOP = new Set(["the","a","an","and","or","but","if","of","to","in","on","at","for","with","from","by","as","is","are","was","were","be","been","being","do","does","did","have","has","had","will","would","can","could","should","may","might","must","not","no","it","its","this","that","these","those","he","she","they","we","you","i","his","her","their","our","your","my","me","him","them","us","there","here","what","which","who","whom","when","where","why","how","all","any","some","more","most","very","just","also","than","then","so","such","only","own","same","too","out","up","down","off","over","into","about","one","two","many","much","even","still","yet","already","again","back","away","through","during","before","after","between","under","above","last","first","new","old","good","bad","big","small","long","short","high","low","right","left","next","other","another","each","every","both","few","several","against","without","within","along","across","behind","beyond"]);

/** Слова предложения, которые стоит показать человеку: без служебных и предложенных вариантов. */
export function candidateWords(sentence: string, exclude: string[] = []): string[] {
  const skip = new Set(exclude.map((w) => normalizeTerm(w)));
  return [...new Set(
    sentence
      .replace(/_{3,}/g, " ")
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w) && !skip.has(w)),
  )];
}

/**
 * Незнакомое слово из вопроса — то, которого **нет в словаре человека** (баг #26).
 *
 * Жалоба была не про редкое слово языка, а про своё: «подобрать слово к overcome, но оказалось,
 * что подходящее слово вообще мной не изучено». Поэтому проверяем не частотность, а карточки.
 *
 * Первая попытка опиралась на частотность и не нашла ничего на пяти живых вопросах: модель
 * составляет их из обиходных слов, и всё в предложении оказывается частым. Проверка «нет у меня» —
 * измерение по данным человека, а не догадка о том, что он знает.
 */
export function missingFrom(known: Iterable<string>, sentence: string, exclude: string[] = []): string | undefined {
  const have = new Set<string>();
  for (const term of known) {
    for (const form of baseForms(normalizeTerm(term))) have.add(form);
    // Фраза из нескольких слов: «take for granted» покрывает и «granted».
    for (const part of normalizeTerm(term).split(/[^a-z'-]+/)) {
      if (part.length >= 4) for (const form of baseForms(part)) have.add(form);
    }
  }
  return candidateWords(sentence, exclude).find((w) => !baseForms(w).some((f) => have.has(f)));
}
