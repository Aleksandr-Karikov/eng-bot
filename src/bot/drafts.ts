import type { WordDraft } from "../services/words";

export interface Draft extends WordDraft {
  id: number;
  userId: number;
  chatId: number;
  roomId: number;
  awaitingEdit: boolean;
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
    for (const d of this.drafts.values()) if (d.userId === userId && d.chatId === chatId && d.awaitingEdit) return d;
    return undefined;
  }

  delete(id: number): void {
    this.drafts.delete(id);
  }
}
