/** Сообщение группы, которое бот видел. date — секунды Unix, как в Telegram. */
export interface SeenMessage {
  messageId: number;
  /** Telegram id автора — чтобы склеивать реплику, разбитую на несколько сообщений. */
  authorId?: number;
  author: string;
  text: string;
  date: number;
  /** Переслано из другого чата — автор неизвестен. */
  forwarded?: boolean;
}

/**
 * Последние сообщения каждой группы — только в памяти, чтобы /check мог показать Claude контекст.
 * После перезапуска бота буфер пустой: у Telegram нет API, чтобы прочитать историю чата.
 */
export class ChatHistory {
  private readonly chats = new Map<number, SeenMessage[]>();

  /** С запасом: 👀 ставят и на сообщения часовой давности, а текст бот может взять только отсюда. */
  constructor(private readonly perChat = 300) {}

  find(chatId: number, messageId: number): SeenMessage | undefined {
    return this.chats.get(chatId)?.find((m) => m.messageId === messageId);
  }

  record(chatId: number, message: SeenMessage): void {
    const list = this.chats.get(chatId) ?? [];
    list.push(message);
    if (list.length > this.perChat) list.splice(0, list.length - this.perChat);
    this.chats.set(chatId, list);
  }

  /**
   * Начало той же реплики: сообщения автора target, идущие подряд прямо перед ним
   * (без чужих между ними, с паузами не больше maxGapSec), от старых к новым.
   */
  leadIn(chatId: number, target: { messageId: number; date: number; authorId: number }, maxGapSec: number): SeenMessage[] {
    const before = (this.chats.get(chatId) ?? []).filter((m) => m.messageId < target.messageId);
    const parts: SeenMessage[] = [];
    let next = target.date;
    for (let i = before.length - 1; i >= 0; i--) {
      const m = before[i];
      if (m.authorId !== target.authorId || next - m.date > maxGapSec) break;
      parts.unshift(m);
      next = m.date;
    }
    return parts;
  }

  /** До limit сообщений перед target (не старше maxAgeSec относительно него), от старых к новым. */
  before(chatId: number, target: { messageId: number; date: number }, limit: number, maxAgeSec: number): SeenMessage[] {
    return (this.chats.get(chatId) ?? [])
      .filter((m) => m.messageId < target.messageId && m.date >= target.date - maxAgeSec)
      .slice(-limit);
  }
}
