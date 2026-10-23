import type { ClozeSentence } from "../db/schema";

interface PendingBase {
  cardId: number;
  reps: number;
  wordId: number;
  term: string;
  chatId: number;
  /** Тренировка вне зачёта: ответ проверяется, но карточка не оценивается. */
  practice?: boolean;
  /** Сообщение с заданием: после ответа с него убираем «🤷 Не знаю», чтобы не висели мёртвые кнопки. */
  messageId?: number;
}

/** Упражнение, на которое ждём ответ сообщением: вставь по смыслу, своё предложение, диктант. Одно на пользователя, в памяти. */
export type PendingExercise = PendingBase &
  ({ kind: "cloze"; sentence: ClozeSentence } | { kind: "sentence" } | { kind: "listen" });

/**
 * Ответ на упражнение ждём долго: человек может отвлечься посреди /learn и вернуться через полчаса.
 * Ожидание снимает следующая карточка или любая команда; 15 минут, как у прочих «пришли ответом», — мало:
 * ответ, присланный позже, уходил в /add и становился «новым словом».
 */
export const EXERCISE_TTL_MS = 12 * 60 * 60_000;

/** Где хранить ожидания, чтобы они пережили перезапуск. */
export interface ExercisePersistence {
  load(): Promise<Array<{ userId: number; exercise: PendingExercise; since: number }>>;
  save(userId: number, exercise: PendingExercise | undefined, since: number): Promise<void>;
}

export class ExerciseStore {
  private readonly pending = new Map<number, PendingExercise & { since: number }>();
  /** Записи в базу — строго по очереди, иначе «удалить» могло бы обогнать «сохранить». */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly persistence?: ExercisePersistence,
    private readonly now: () => number = Date.now,
  ) {}

  /** Поднимает сохранённые ожидания — один раз при старте бота. */
  async load(): Promise<void> {
    for (const { userId, exercise, since } of (await this.persistence?.load()) ?? []) this.pending.set(userId, { ...exercise, since });
  }

  set(userId: number, exercise: PendingExercise): void {
    const since = this.now();
    this.pending.set(userId, { ...exercise, since });
    this.persist(userId, exercise, since);
  }

  get(userId: number): PendingExercise | undefined {
    const exercise = this.pending.get(userId);
    if (!exercise) return undefined;
    if (this.now() - exercise.since < EXERCISE_TTL_MS) return exercise;
    this.delete(userId);
    return undefined;
  }

  /** chatId — снять, только если ждём ответ в этом чате. */
  delete(userId: number, chatId?: number): void {
    if (chatId !== undefined && this.pending.get(userId)?.chatId !== chatId) return;
    if (!this.pending.delete(userId)) return;
    this.persist(userId, undefined, this.now());
  }

  private persist(userId: number, exercise: PendingExercise | undefined, since: number): void {
    // Не ждём базу: ответ пользователю важнее, а потерять ожидание при сбое записи — не страшно.
    const persistence = this.persistence;
    if (!persistence) return;
    this.writes = this.writes
      .then(() => persistence.save(userId, exercise, since))
      .catch((err) => console.error("Pending exercise save failed", userId, err));
  }
}
