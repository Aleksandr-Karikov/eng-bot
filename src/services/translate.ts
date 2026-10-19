import { and, eq, lt, ne, or, isNull } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, words } from "../db/schema";
import type { TranslationInput } from "../llm/tutor";
import { mistakeProfile, recentMistakes } from "./mistakes";
import { LEARNED_STABILITY_DAYS } from "./stats";

const TOPICS = 4;
const WORDS = 6;

export interface TranslationMaterial extends TranslationInput {
  /** term → карточка ученика, чтобы засчитать верно употреблённое слово. */
  cardByTerm: Map<string, { cardId: number; wordId: number }>;
}

/** Из чего строить предложения: открытые темы ошибок и слова, которые ещё учатся (не необязательные). */
export async function translationMaterial(db: Db, userId: number, now: Date, random: () => number, avoid: string[]): Promise<TranslationMaterial> {
  const profile = mistakeProfile(await recentMistakes(db, userId, now));
  const learning = await db
    .select({ cardId: cards.id, wordId: words.id, term: words.term, translation: words.translation })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(
      and(
        eq(cards.userId, userId),
        ne(cards.state, State.New),
        lt(cards.stability, LEARNED_STABILITY_DAYS),
        or(isNull(words.usefulness), ne(words.usefulness, 1)),
      ),
    );
  const picked = learning
    .map((w) => ({ w, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, WORDS)
    .map((x) => x.w);
  return {
    topics: profile.categories.slice(0, TOPICS).map((c) => ({ category: c.category, examples: c.examples })),
    words: picked.map((w) => ({ term: w.term, translation: w.translation })),
    avoid,
    cardByTerm: new Map(picked.map((w) => [w.term.toLowerCase(), { cardId: w.cardId, wordId: w.wordId }])),
  };
}
