/** Кто сейчас придумывает название новой комнаты и в каком чате ждём ответ. В памяти. */
export class RoomNameStore {
  private readonly pending = new Map<number, number>();

  ask(userId: number, chatId: number): void {
    this.pending.set(userId, chatId);
  }

  /** chatId, если ждём название от пользователя в этом чате; ожидание снимается. */
  take(userId: number, chatId: number): boolean {
    if (this.pending.get(userId) !== chatId) return false;
    this.pending.delete(userId);
    return true;
  }
}
