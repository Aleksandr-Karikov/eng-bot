import { isFresh } from "./pending";

/** «✍️ Свой вариант» картинки: какое слово перерисовываем и в каком чате ждём описание. В памяти. */
export class PictureWishStore {
  private readonly pending = new Map<number, { wordId: number; chatId: number; since: number }>();

  ask(userId: number, wordId: number, chatId: number): void {
    this.pending.set(userId, { wordId, chatId, since: Date.now() });
  }

  /** wordId, если ждём описание от пользователя в этом чате; ожидание снимается. */
  take(userId: number, chatId: number): number | undefined {
    const entry = this.pending.get(userId);
    if (entry?.chatId !== chatId) return undefined;
    this.pending.delete(userId);
    return isFresh(entry.since) ? entry.wordId : undefined;
  }

  /** chatId — снять, только если ждём ответ в этом чате. */
  clear(userId: number, chatId?: number): void {
    if (chatId !== undefined && this.pending.get(userId)?.chatId !== chatId) return;
    this.pending.delete(userId);
  }
}
