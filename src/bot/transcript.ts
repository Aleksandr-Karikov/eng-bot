/** Строка недавней переписки чата — контекст для /bug. */
export interface TranscriptEntry {
  at: number;
  from: "bot" | "user";
  name?: string;
  text: string;
}

/** Сколько последних сообщений помнить на чат. */
const PER_CHAT = 15;
/** Сколько чатов держать: старые вытесняются, чтобы память не росла. */
const MAX_CHATS = 500;
const MAX_TEXT = 1500;

/** Недавняя переписка каждого чата в памяти — бот и люди, включая нажатые кнопки. Только для /bug. */
export class ChatTranscript {
  private readonly chats = new Map<number, TranscriptEntry[]>();

  record(chatId: number, entry: Omit<TranscriptEntry, "at">): void {
    if (!entry.text.trim()) return;
    const list = this.chats.get(chatId) ?? [];
    list.push({ ...entry, text: entry.text.slice(0, MAX_TEXT), at: Date.now() });
    if (list.length > PER_CHAT) list.splice(0, list.length - PER_CHAT);
    this.chats.delete(chatId);
    this.chats.set(chatId, list);
    if (this.chats.size > MAX_CHATS) this.chats.delete(this.chats.keys().next().value!);
  }

  recent(chatId: number): TranscriptEntry[] {
    return [...(this.chats.get(chatId) ?? [])];
  }
}

/** Текст кнопок inline-клавиатуры — видно, что человеку предлагали нажать. */
export function buttonsText(markup: unknown): string {
  const rows = (markup as { inline_keyboard?: Array<Array<{ text: string }>> } | undefined)?.inline_keyboard;
  return rows?.length ? `\n[кнопки: ${rows.flat().map((b) => b.text).join(" | ")}]` : "";
}
