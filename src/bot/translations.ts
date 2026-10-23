import type { TranslationTask } from "../llm/tutor";

/** Задание тренажёра перевода с карточкой слова, которое в нём ожидается. */
export interface ActiveTask extends TranslationTask {
  card?: { cardId: number; wordId: number };
}

export interface TranslateSession {
  chatId: number;
  /** Задание, на которое ждём перевод; undefined — пока проверяем или готовим следующее. */
  task?: ActiveTask;
  /** Следующее задание готовится, пока человек переводит текущее. */
  next?: Promise<ActiveTask | undefined>;
  /** Задание прямо сейчас готовится (первое или после ответа). */
  preparing?: boolean;
  /** Под разбором ответа ждём «▶ Дальше» — следующее предложение придёт по кнопке. */
  paused?: boolean;
  /** Сообщение с текущим заданием: после ответа убираем с него кнопки. */
  taskMessageId?: number;
  recent: string[];
  done: number;
  correct: number;
  lastAt: number;
}

const TTL_MS = 30 * 60_000;
export const RECENT_TASKS = 20;

/** Сеанс /translate — в памяти, один на пользователя; брошенный через полчаса не перехватывает сообщения. */
export class TranslateStore {
  private readonly sessions = new Map<number, TranslateSession>();

  start(userId: number, chatId: number): TranslateSession {
    const session: TranslateSession = { chatId, recent: [], done: 0, correct: 0, lastAt: Date.now() };
    this.sessions.set(userId, session);
    return session;
  }

  get(userId: number): TranslateSession | undefined {
    const session = this.sessions.get(userId);
    if (session && Date.now() - session.lastAt > TTL_MS) {
      this.sessions.delete(userId);
      return undefined;
    }
    return session;
  }

  end(userId: number): TranslateSession | undefined {
    const session = this.sessions.get(userId);
    this.sessions.delete(userId);
    return session;
  }
}
