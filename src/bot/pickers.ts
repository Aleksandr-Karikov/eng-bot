import { startSeq } from "./seq";
/** Список слов для /delete: что показано и на какой странице. Живёт в памяти, один на пользователя. */
export interface Picker {
  id: number;
  userId: number;
  items: Array<{ wordId: number; label: string }>;
  page: number;
  /** Что делать с выбранным словом. */
  action: "delete" | "edit";
}

export class PickerStore {
  /** С момента запуска: старая кнопка после перезапуска не попадёт в новую запись с тем же номером. */
  private seq = startSeq();
  private readonly pickers = new Map<number, Picker>();

  create(userId: number, items: Picker["items"], action: Picker["action"]): Picker {
    for (const [id, p] of this.pickers) if (p.userId === userId) this.pickers.delete(id);
    const picker: Picker = { id: ++this.seq, userId, items, page: 0, action };
    this.pickers.set(picker.id, picker);
    return picker;
  }

  get(id: number): Picker | undefined {
    return this.pickers.get(id);
  }
}
