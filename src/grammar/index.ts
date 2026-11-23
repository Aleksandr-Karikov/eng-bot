import { A1_TOPICS } from "./a1";
import { A1_BE_POSSESSIVES } from "./a1-be-and-possessives";
import { A1_QUANTITY_PLANS } from "./a1-quantity-and-plans";
import { A1_VERBS_QUESTIONS } from "./a1-verbs-and-questions";
import { A2_TOPICS } from "./a2";
import { A2_ADJECTIVES_FUTURE } from "./a2-adjectives-and-future";
import { B1_TOPICS } from "./b1";
import { B1_EXTRA } from "./b1-extra";
import { B1_MODALS } from "./b1-modals";
import { B1_SYNTAX } from "./b1-syntax";
import { B1_TENSES } from "./b1-tenses";
import { B2_PASSIVE } from "./b2-passive";
import { B2_TOPICS } from "./b2";
import { B2_VERBS } from "./b2-verbs";
import { C1_ADVANCED } from "./c1-advanced";
import { C1_TOPICS } from "./c1";
import type { TopicDraft } from "./types";

export type { ExerciseDraft, GrammarKind, TopicDraft } from "./types";

/**
 * 📘 Весь контент грамматики, от простого к сложному.
 *
 * Разложен по уровням в отдельных файлах, а не в одном: файл на шесть сотен строк неудобно править,
 * а так каждый уровень — это несколько файлов, которые можно читать и дополнять целиком.
 *
 * Внутри уровня продолжения идут после базовых тем: человек, проходящий A1 подряд, сначала видит
 * простое время, а уже потом притяжательные и наречия частоты.
 *
 * Порядок здесь — порядок показа человеку: A1 → A2 → B1 → B2 → C1. Программа уровней и требования
 * к темам — `docs/grammar-syllabus.md`.
 */
export const GRAMMAR_TOPICS: TopicDraft[] = [
  ...A1_TOPICS,
  ...A1_BE_POSSESSIVES,
  ...A1_VERBS_QUESTIONS,
  ...A1_QUANTITY_PLANS,
  ...A2_TOPICS,
  ...A2_ADJECTIVES_FUTURE,
  ...B1_TOPICS,
  ...B1_TENSES,
  ...B1_MODALS,
  ...B1_SYNTAX,
  ...B1_EXTRA,
  ...B2_TOPICS,
  ...B2_PASSIVE,
  ...B2_VERBS,
  ...C1_TOPICS,
  ...C1_ADVANCED,
];
