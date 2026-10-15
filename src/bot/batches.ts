import type { Word } from "../db/schema";
import type { WordDraft } from "../services/words";

/** Пачка слов из /text. Живёт в памяти, одна активная на пользователя. */
export class Batch {
  readonly selected: boolean[];
  /** Индексы выбранных слов для режима «по одному» и текущая позиция в нём. */
  queue: number[] = [];
  position = 0;
  readonly saved: Word[] = [];

  constructor(
    readonly id: number,
    readonly userId: number,
    readonly chatId: number,
    readonly roomId: number,
    readonly items: WordDraft[],
  ) {
    this.selected = items.map(() => true);
  }

  toggle(index: number): void {
    if (index >= 0 && index < this.items.length) this.selected[index] = !this.selected[index];
  }

  selectedItems(): WordDraft[] {
    return this.items.filter((_, i) => this.selected[i]);
  }
}

export class BatchStore {
  private seq = 0;
  private readonly batches = new Map<number, Batch>();

  create(input: { userId: number; chatId: number; roomId: number; items: WordDraft[] }): Batch {
    for (const [id, b] of this.batches) if (b.userId === input.userId) this.batches.delete(id);
    const batch = new Batch(++this.seq, input.userId, input.chatId, input.roomId, input.items);
    this.batches.set(batch.id, batch);
    return batch;
  }

  get(id: number): Batch | undefined {
    return this.batches.get(id);
  }

  delete(id: number): void {
    this.batches.delete(id);
  }
}
