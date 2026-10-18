import type { ClozeSentence } from "../db/schema";
import { isFresh } from "./pending";

/** Упражнение «вставь по смыслу», на которое ждём ответ сообщением. Одно на пользователя, в памяти. */
export interface PendingCloze {
  cardId: number;
  reps: number;
  wordId: number;
  term: string;
  chatId: number;
  sentence: ClozeSentence;
  /** Тренировка вне зачёта: ответ проверяется, но карточка не оценивается. */
  practice?: boolean;
}

export class ExerciseStore {
  private readonly pending = new Map<number, PendingCloze & { since: number }>();

  set(userId: number, exercise: PendingCloze): void {
    this.pending.set(userId, { ...exercise, since: Date.now() });
  }

  get(userId: number): PendingCloze | undefined {
    const exercise = this.pending.get(userId);
    if (exercise && !isFresh(exercise.since)) this.pending.delete(userId);
    return exercise && isFresh(exercise.since) ? exercise : undefined;
  }

  delete(userId: number): void {
    this.pending.delete(userId);
  }
}
