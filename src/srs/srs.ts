import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

export type Answer = "again" | "hard" | "good" | "easy";

/** Поля совпадают с колонками таблицы cards — можно передавать прямо в insert/update. */
export interface SrsSnapshot {
  due: Date;
  state: number;
  reps: number;
  stability: number;
  fsrs: string;
}

const GRADES: Record<Answer, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/**
 * Целевая вероятность вспомнить слово к следующему повторению — по полезности:
 * 🟢 держим крепче (чаще повторяем), ⚪️ отпускаем (повторяем реже, иногда забудется — и ладно, его хватит узнать).
 * Время повторений само перетекает от редких слов к ходовым.
 */
export const RETENTION: Record<number, number> = { 3: 0.92, 2: 0.9, 1: 0.87 };
const DEFAULT_RETENTION = 0.9;

const schedulers = new Map<number, ReturnType<typeof fsrs>>();
function schedulerFor(retention: number) {
  let s = schedulers.get(retention);
  if (!s) schedulers.set(retention, (s = fsrs(generatorParameters({ enable_fuzz: false, request_retention: retention }))));
  return s;
}

export function retentionFor(usefulness: number | null | undefined): number {
  return (usefulness && RETENTION[usefulness]) || DEFAULT_RETENTION;
}

function snapshot(card: Card): SrsSnapshot {
  return { due: card.due, state: card.state, reps: card.reps, stability: card.stability, fsrs: JSON.stringify(card) };
}

function parse(json: string): Card {
  const raw = JSON.parse(json);
  return { ...raw, due: new Date(raw.due), last_review: raw.last_review ? new Date(raw.last_review) : undefined };
}

export function newCard(now: Date): SrsSnapshot {
  return snapshot(createEmptyCard(now));
}

/** usefulness — полезность слова: от неё зависит, насколько далеко отодвинуть следующее повторение. */
export function review(fsrsJson: string, answer: Answer, now: Date, usefulness?: number | null): SrsSnapshot {
  return snapshot(schedulerFor(retentionFor(usefulness)).next(parse(fsrsJson), now, GRADES[answer]).card);
}
