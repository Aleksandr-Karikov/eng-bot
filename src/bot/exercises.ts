import type { ClozeSentence } from "../db/schema";
import { isFresh } from "./pending";

interface PendingBase {
  cardId: number;
  reps: number;
  wordId: number;
  term: string;
  chatId: number;
  /** Тренировка вне зачёта: ответ проверяется, но карточка не оценивается. */
  practice?: boolean;
}

/** Упражнение, на которое ждём ответ сообщением: вставь по смыслу, своё предложение, диктант. Одно на пользователя, в памяти. */
export type PendingExercise = PendingBase &
  ({ kind: "cloze"; sentence: ClozeSentence } | { kind: "sentence" } | { kind: "listen" });

export class ExerciseStore {
  private readonly pending = new Map<number, PendingExercise & { since: number }>();

  set(userId: number, exercise: PendingExercise): void {
    this.pending.set(userId, { ...exercise, since: Date.now() });
  }

  get(userId: number): PendingExercise | undefined {
    const exercise = this.pending.get(userId);
    if (exercise && !isFresh(exercise.since)) this.pending.delete(userId);
    return exercise && isFresh(exercise.since) ? exercise : undefined;
  }

  delete(userId: number): void {
    this.pending.delete(userId);
  }
}
