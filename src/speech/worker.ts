import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type WorkerReply = { ok?: boolean; error?: string } & Record<string, unknown>;

/**
 * Постоянный процесс на Python (Kokoro, распознавание речи): модель грузится один раз, запросы идут
 * строками JSON с id, ответы — тоже, по строке на запрос; первой строкой процесс пишет {"ready": true}.
 * Упал или не запустился — текущие запросы получают ошибку, следующий запрос запускает процесс заново.
 */
export class JsonLineWorker {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (msg: WorkerReply) => void; reject: (err: Error) => void }>();

  constructor(
    private readonly name: string,
    private readonly python: string,
    private readonly script: string,
    /** Первый запуск грузит модель (а в самый первый раз — скачивает). */
    private readonly startTimeoutMs: number,
  ) {}

  async request(body: Record<string, unknown>, timeoutMs: number): Promise<WorkerReply> {
    await this.start();
    const id = ++this.seq;
    return new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${this.name} timeout`));
      }, timeoutMs);
      this.waiting.set(id, {
        resolve: (msg) => (clearTimeout(timer), msg.ok ? resolve(msg) : reject(new Error(msg.error ?? `${this.name} error`))),
        reject: (err) => (clearTimeout(timer), reject(err)),
      });
      this.proc!.stdin.write(`${JSON.stringify({ ...body, id })}\n`);
    });
  }

  /** Остановить процесс (при выключении бота). */
  close(): void {
    this.proc?.kill();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const proc = spawn(this.python, [this.script], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} did not start`)), this.startTimeoutMs);
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg: WorkerReply & { ready?: boolean; id?: number };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) {
          clearTimeout(timer);
          return resolve();
        }
        const waiter = msg.id !== undefined ? this.waiting.get(msg.id) : undefined;
        if (!waiter) return;
        this.waiting.delete(msg.id!);
        waiter.resolve(msg);
      });
      // Предупреждения библиотек — в stderr; в лог бота только последнее, если процесс упал.
      let lastErr = "";
      proc.stderr.on("data", (chunk: Buffer) => (lastErr = chunk.toString().slice(-500)));
      // Не запустился вовсе (нет python) — без этого обработчика Node уронил бы весь процесс бота.
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
        for (const w of this.waiting.values()) w.reject(err);
        this.waiting.clear();
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        const err = new Error(`${this.name} exited (${code}): ${lastErr.trim()}`);
        reject(err);
        for (const w of this.waiting.values()) w.reject(err);
        this.waiting.clear();
        if (this.proc === proc) {
          this.proc = undefined;
          this.ready = undefined;
        }
      });
    });
    // Не запустился — сбросить, чтобы попробовать снова со следующим запросом.
    this.ready.catch(() => {
      if (this.proc === proc) {
        proc.kill();
        this.proc = undefined;
        this.ready = undefined;
      }
    });
    return this.ready;
  }
}
