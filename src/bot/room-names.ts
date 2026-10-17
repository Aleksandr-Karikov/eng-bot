/** Кто сейчас придумывает название комнаты (новой или для переименования) и в каком чате ждём ответ. В памяти. */
interface PendingName {
  chatId: number;
  /** Если задано — переименовываем эту комнату, иначе создаём новую. */
  renameRoomId?: number;
}

export class RoomNameStore {
  private readonly pending = new Map<number, PendingName>();

  ask(userId: number, chatId: number, renameRoomId?: number): void {
    this.pending.set(userId, { chatId, renameRoomId });
  }

  /** Ожидание от пользователя в этом чате, если оно есть; снимается. */
  take(userId: number, chatId: number): PendingName | undefined {
    const entry = this.pending.get(userId);
    if (entry?.chatId !== chatId) return undefined;
    this.pending.delete(userId);
    return entry;
  }
}
