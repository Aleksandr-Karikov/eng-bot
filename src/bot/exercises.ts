import type { ClozeSentence } from "../db/schema";

/** Упражнение «вставь по смыслу», на которое ждём ответ сообщением. Одно на пользователя, в памяти. */
export interface PendingCloze {
  cardId: number;
  reps: number;
  wordId: number;
  term: string;
  chatId: number;
  sentence: ClozeSentence;
}

export class ExerciseStore {
  private readonly pending = new Map<number, PendingCloze>();

  set(userId: number, exercise: PendingCloze): void {
    this.pending.set(userId, exercise);
  }

  get(userId: number): PendingCloze | undefined {
    return this.pending.get(userId);
  }

  delete(userId: number): void {
    this.pending.delete(userId);
  }
}
