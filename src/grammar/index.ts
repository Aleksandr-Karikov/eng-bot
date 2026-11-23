import { A1_TOPICS } from "./a1";
import { A2_TOPICS } from "./a2";
import { B1_TOPICS } from "./b1";
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
 * а так каждый уровень — это один файл, который можно читать и дополнять целиком.
 *
 * Порядок здесь — порядок показа человеку: A1 → A2 → B1 → B2 → C1.
 */
export const GRAMMAR_TOPICS: TopicDraft[] = [
  ...A1_TOPICS,
  ...A2_TOPICS,
  ...B1_TOPICS,
  ...B1_TENSES,
  ...B1_MODALS,
  ...B1_SYNTAX,
  ...B2_TOPICS,
  ...B2_PASSIVE,
  ...B2_VERBS,
  ...C1_TOPICS,
  ...C1_ADVANCED,
];
