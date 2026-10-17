import type { WordDraft } from "../services/words";
import { isFresh } from "./pending";

export interface Draft extends WordDraft {
  id: number;
  userId: number;
  chatId: number;
  roomId: number;
  awaitingEdit: boolean;
  /** Когда бот попросил прислать перевод — ожидание истекает через PENDING_TTL_MS. */
  awaitingSince?: number;
  /** Черновик из пачки /text в режиме «по одному»: id пачки и подпись «3/6». */
  batchId?: number;
  progress?: string;
}

/** Черновики живут в памяти: после перезапуска бота слово нужно добавить заново. */
export class DraftStore {
  private seq = 0;
  private readonly drafts = new Map<number, Draft>();

  create(input: Omit<Draft, "id" | "awaitingEdit">): Draft {
    for (const [id, d] of this.drafts) if (d.userId === input.userId) this.drafts.delete(id);
    const draft: Draft = { ...input, id: ++this.seq, awaitingEdit: false };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  get(id: number): Draft | undefined {
    return this.drafts.get(id);
  }

  findAwaiting(userId: number, chatId: number): Draft | undefined {
    for (const d of this.drafts.values()) {
      if (d.userId === userId && d.chatId === chatId && d.awaitingEdit && isFresh(d.awaitingSince ?? 0)) return d;
    }
    return undefined;
  }

  clearAwaiting(userId: number): void {
    for (const d of this.drafts.values()) if (d.userId === userId) d.awaitingEdit = false;
  }

  delete(id: number): void {
    this.drafts.delete(id);
  }
}
