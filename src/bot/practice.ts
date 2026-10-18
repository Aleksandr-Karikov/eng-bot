/** Тренировка вне зачёта: какие карточки ещё показать. В памяти, одна на пользователя. */
export class PracticeStore {
  private readonly sessions = new Map<number, number[]>();

  start(userId: number, queue: number[]): void {
    this.sessions.set(userId, [...queue]);
  }

  /** Следующая карточка или undefined, если тренировка закончилась (или её нет). */
  next(userId: number): number | undefined {
    const queue = this.sessions.get(userId);
    const id = queue?.shift();
    if (id === undefined) this.sessions.delete(userId);
    return id;
  }

  stop(userId: number): void {
    this.sessions.delete(userId);
  }
}
