/** Тренировка вне зачёта: какие карточки ещё показать. В памяти, одна на пользователя. */
export class PracticeStore {
  private readonly sessions = new Map<number, number[]>();
  private readonly storms = new Map<number, { queue: Array<{ id: number; reverse: boolean }>; current?: { id: number; reverse: boolean }; attempt: number }>();

  start(userId: number, queue: number[]): void {
    this.storms.delete(userId);
    this.sessions.set(userId, [...queue]);
  }

  startStorm(userId: number, ids: number[]): void {
    this.sessions.delete(userId);
    this.storms.set(userId, { queue: [...ids.map((id) => ({ id, reverse: false })), ...ids.map((id) => ({ id, reverse: true }))], attempt: 0 });
  }

  isStorm(userId: number): boolean { return this.storms.has(userId); }
  stormReverse(userId: number): boolean { return this.storms.get(userId)?.current?.reverse ?? false; }
  stormAttempt(userId: number): number { return this.storms.get(userId)?.attempt ?? 0; }

  /** Ошибка возвращает то же задание в конец очереди; старые кнопки игнорируются. */
  stormAnswer(userId: number, cardId: number, remembered: boolean, attempt?: number): boolean {
    const session = this.storms.get(userId);
    if (!session?.current || session.current.id !== cardId || session.attempt !== attempt) return false;
    if (!remembered) session.queue.push(session.current);
    session.current = undefined;
    return true;
  }

  /** Следующая карточка или undefined, если тренировка закончилась (или её нет). */
  next(userId: number): number | undefined {
    const storm = this.storms.get(userId);
    if (storm) {
      storm.current = storm.queue.shift();
      if (storm.current) storm.attempt++;
      return storm.current?.id;
    }
    const queue = this.sessions.get(userId);
    const id = queue?.shift();
    if (id === undefined) this.sessions.delete(userId);
    return id;
  }

  stop(userId: number): void {
    this.sessions.delete(userId);
    this.storms.delete(userId);
  }
}
