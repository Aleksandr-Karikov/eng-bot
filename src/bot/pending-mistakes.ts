import type { CheckResult } from "../llm/enricher";

/** Ошибки из /check, ждущие подтверждения «сохранить в работу над ошибками». В памяти, сутки. */
export interface PendingMistakes {
  authorUserId: number;
  /** Имя автора для текста; undefined — проверял свой текст. */
  authorName?: string;
  callerUserId: number;
  fixes: CheckResult["fixes"];
  /** Текст сообщения бота без строки-вопроса — чтобы заменить её итогом. */
  baseText: string;
  since: number;
}

const TTL_MS = 24 * 60 * 60_000;

export class PendingMistakesStore {
  private seq = 0;
  private readonly pending = new Map<number, PendingMistakes>();

  create(entry: Omit<PendingMistakes, "since">): number {
    const id = ++this.seq;
    this.pending.set(id, { ...entry, since: Date.now() });
    return id;
  }

  /** Забирает запись (одноразово); просроченная считается отсутствующей. */
  take(id: number): PendingMistakes | undefined {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    return entry && Date.now() - entry.since < TTL_MS ? entry : undefined;
  }

  peek(id: number): PendingMistakes | undefined {
    const entry = this.pending.get(id);
    return entry && Date.now() - entry.since < TTL_MS ? entry : undefined;
  }
}
