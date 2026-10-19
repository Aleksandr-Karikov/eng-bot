/**
 * «Не дёргать снова»: если Claude не смог что-то подготовить для слова, не спрашивать его на каждом показе —
 * каждый запрос это отдельный процесс Claude Code. Пробуем снова через RETRY_MS.
 */
export const RETRY_MS = 30 * 60_000;

export class RetryLater {
  private readonly until = new Map<number, number>();

  constructor(private readonly now: () => number = Date.now) {}

  blocked(id: number): boolean {
    const until = this.until.get(id);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.until.delete(id);
    return false;
  }

  failed(id: number): void {
    this.until.set(id, this.now() + RETRY_MS);
  }
}
