/** Сообщение группы, которое бот видел. date — секунды Unix, как в Telegram. */
export interface SeenMessage {
  messageId: number;
  author: string;
  text: string;
  date: number;
}

/**
 * Последние сообщения каждой группы — только в памяти, чтобы /check мог показать Claude контекст.
 * После перезапуска бота буфер пустой: у Telegram нет API, чтобы прочитать историю чата.
 */
export class ChatHistory {
  private readonly chats = new Map<number, SeenMessage[]>();

  constructor(private readonly perChat = 20) {}

  record(chatId: number, message: SeenMessage): void {
    const list = this.chats.get(chatId) ?? [];
    list.push(message);
    if (list.length > this.perChat) list.splice(0, list.length - this.perChat);
    this.chats.set(chatId, list);
  }

  /** До limit сообщений перед target (не старше maxAgeSec относительно него), от старых к новым. */
  before(chatId: number, target: { messageId: number; date: number }, limit: number, maxAgeSec: number): SeenMessage[] {
    return (this.chats.get(chatId) ?? [])
      .filter((m) => m.messageId < target.messageId && m.date >= target.date - maxAgeSec)
      .slice(-limit);
  }
}
