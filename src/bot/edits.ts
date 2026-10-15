/** Ожидающая правка: какое слово пользователь исправляет и в каком чате ждём ответ. Одна на пользователя, в памяти. */
export interface PendingEdit {
  wordId: number;
  chatId: number;
}

export class EditStore {
  private readonly pending = new Map<number, PendingEdit>();

  set(userId: number, edit: PendingEdit): void {
    this.pending.set(userId, edit);
  }

  get(userId: number): PendingEdit | undefined {
    return this.pending.get(userId);
  }

  delete(userId: number): void {
    this.pending.delete(userId);
  }
}
