import { EXERCISE_TTL_MS } from "./exercises";

/**
 * Упражнение грамматики, на которое ждём ответ сообщением.
 *
 * Нужно потому, что `gap` и `order` больше не показывают готовых вариантов: человек пишет форму сам.
 * Без такой записи присланный текст ушёл бы в `/add` и стал бы «новым словом» — ровно та ошибка,
 * из-за которой в проекте уже появились `ExerciseStore` и `TranslateStore`.
 */
export interface PendingGrammarAnswer {
  exerciseId: number;
  topicId: number;
  chatId: number;
  /**
   * Сообщение с заданием. В группе ответ принимается только реплаем на него: бот видит всю переписку,
   * и любая фраза «works» в чате иначе считалась бы ответом. В личке реплай не нужен.
   */
  messageId?: number;
  since: number;
}

/**
 * Одно ожидание на человека, в памяти — как и прочие «пришли ответом» (`RoomNameStore`, `ExerciseStore`).
 *
 * TTL длинный, как у упражнений: человек может отвлечься посреди темы и вернуться. Короткий TTL означал бы,
 * что поздний ответ молча уходит в `/add` — то есть становится новым словом вместо ответа.
 */
export class GrammarAnswerStore {
  private readonly pending = new Map<number, PendingGrammarAnswer>();

  set(userId: number, value: Omit<PendingGrammarAnswer, "since">): void {
    this.pending.set(userId, { ...value, since: Date.now() });
  }

  /** Забрать ожидание: снимается, чтобы один ответ не проверился дважды. */
  take(userId: number): PendingGrammarAnswer | undefined {
    const entry = this.pending.get(userId);
    if (!entry) return undefined;
    this.pending.delete(userId);
    // Просроченное ожидание не отдаём — но и не оставляем: иначе оно всплыло бы позже.
    return Date.now() - entry.since < EXERCISE_TTL_MS ? entry : undefined;
  }

  /** Есть ли живое ожидание в этом чате — по нему решаем, показывать ли подсказку «впиши ответ». */
  has(userId: number): boolean {
    const entry = this.pending.get(userId);
    if (!entry) return false;
    if (Date.now() - entry.since >= EXERCISE_TTL_MS) {
      this.pending.delete(userId);
      return false;
    }
    return true;
  }

  /** chatId — снять, только если ждём ответ в этом чате. */
  clear(userId: number, chatId?: number): void {
    if (chatId !== undefined && this.pending.get(userId)?.chatId !== chatId) return;
    this.pending.delete(userId);
  }
}
