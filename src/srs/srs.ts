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

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

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

export function review(fsrsJson: string, answer: Answer, now: Date): SrsSnapshot {
  return snapshot(scheduler.next(parse(fsrsJson), now, GRADES[answer]).card);
}
