/** Ожидающая правка: какое слово пользователь исправляет и в каком чате ждём ответ. Одна на пользователя, в памяти. */
import { isFresh } from "./pending";

export interface PendingEdit {
  wordId: number;
  chatId: number;
}

export class EditStore {
  private readonly pending = new Map<number, PendingEdit & { since: number }>();

  set(userId: number, edit: PendingEdit): void {
    this.pending.set(userId, { ...edit, since: Date.now() });
  }

  get(userId: number): PendingEdit | undefined {
    const edit = this.pending.get(userId);
    if (edit && !isFresh(edit.since)) this.pending.delete(userId);
    return edit && isFresh(edit.since) ? edit : undefined;
  }

  /** chatId — снять, только если ждём ответ в этом чате. */
  delete(userId: number, chatId?: number): void {
    if (chatId !== undefined && this.pending.get(userId)?.chatId !== chatId) return;
    this.pending.delete(userId);
  }
}
