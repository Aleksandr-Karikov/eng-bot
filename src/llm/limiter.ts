/**
 * Не больше limit одновременных задач; ждущие — по очереди, но срочные (то, чего человек ждёт прямо сейчас)
 * проходят раньше фоновых. Каждый запрос к Claude Code — отдельный процесс, десяток сразу перегружает Мак.
 */
export class Limiter {
  private running = 0;
  private readonly waiting: Array<{ urgent: boolean; start: () => void }> = [];

  constructor(private readonly limit: number) {}

  async run<T>(urgent: boolean, job: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((start) => {
        const entry = { urgent, start };
        // Срочные — перед всеми фоновыми, но после уже ждущих срочных.
        const at = urgent ? this.waiting.findIndex((w) => !w.urgent) : -1;
        if (at === -1) this.waiting.push(entry);
        else this.waiting.splice(at, 0, entry);
      });
    }
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.start();
    }
  }

  get queued(): number {
    return this.waiting.length;
  }
}
