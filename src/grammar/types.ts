export type GrammarKind = "choice" | "gap" | "order";

export interface ExerciseDraft {
  kind: GrammarKind;
  prompt: string;
  options?: string[];
  answer: string;
  why: string;
}

export interface TopicDraft {
  slug: string;
  title: string;
  level: string;
  /** Язык темы; по умолчанию английский — корейские темы добавятся сюда же. */
  language?: "en" | "ko";
  /**
   * Категория ошибки в терминах /check (`MISTAKE_CATEGORIES`): по ней промах в упражнении попадает
   * в общую работу над ошибками и подмешивается в карточки вместе с ошибками из переписки.
   */
  category: string;
  rule: string;
  examples: string[];
  exercises: ExerciseDraft[];
}
