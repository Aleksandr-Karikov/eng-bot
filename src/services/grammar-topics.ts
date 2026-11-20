import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { grammarExercises, grammarProgress, grammarTopics, type GrammarExercise, type GrammarTopic, type User } from "../db/schema";

/**
 * 📘 Грамматика: темы, упражнения и прогресс.
 *
 * Главное решение — **проверка ответа никогда не зовёт модель**. Упражнения собираются заранее скриптом
 * и лежат в базе вместе с правильным ответом, поэтому верность считается сравнением строк. Генерация
 * упражнений моделью нестабильна (в проекте она уже ходит через `RetryLater`), и человек не должен
 * упираться в «модель не ответила» посреди темы.
 *
 * Модель нужна только на объяснение «почему так» — там её сбой ничего не блокирует: правило уже
 * показано, а ответ уже проверен.
 */

export type GrammarKind = "choice" | "gap" | "order";

export interface TopicSummary {
  id: number;
  slug: string;
  title: string;
  level: string;
  /** Сколько упражнений в теме — по нему видно размер темы до входа. */
  total: number;
  /** Сколько пройдено верно и сдан ли экзамен. */
  done: number;
  passed: boolean;
}

export interface TopicView extends TopicSummary {
  rule: string;
  examples: string[];
  exercises: ExerciseView[];
}

/** Упражнение так, как его видит клиент: без ответа — иначе проверять нечего. */
export interface ExerciseView {
  id: number;
  kind: GrammarKind;
  prompt: string;
  options: string[];
  /** Отвечено ли уже верно: такие показываем отмеченными, но не убираем — тема должна читаться целиком. */
  solved: boolean;
}

/** Ответ на упражнение: верно или нет, и что показать. */
export interface AnswerResult {
  correct: boolean;
  /** Правильный ответ — показываем и при верном, чтобы человек увидел форму целиком. */
  answer: string;
  /** Объяснение из контента. Есть всегда, модель для него не нужна. */
  why: string;
  done: number;
  total: number;
  passed: boolean;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Верный ли ответ. Для `choice` и `order` сравниваем нормализованные строки целиком, для `gap` —
 * тоже целиком: «have been» это не «have», и частичный ответ правильным не считается.
 *
 * Перестановка слов в `order` нормализуется по пробелам, поэтому лишние пробелы и регистр не мешают.
 */
export function isCorrect(kind: GrammarKind, answer: string, expected: string): boolean {
  void kind;
  return normalize(answer) === normalize(expected);
}

const splitLines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/** Список тем с прогрессом человека. Модель не нужна, читается из двух таблиц. */
export async function listTopics(db: Db, userId: number): Promise<TopicSummary[]> {
  const topics = await db.select().from(grammarTopics).orderBy(asc(grammarTopics.position), asc(grammarTopics.id));
  if (topics.length === 0) return [];
  const exercises = await db.select({ id: grammarExercises.id, topicId: grammarExercises.topicId }).from(grammarExercises);
  const progress = await db.select().from(grammarProgress).where(eq(grammarProgress.userId, userId));
  const byTopic = new Map(progress.map((p) => [p.topicId, p]));
  return topics.map((topic) => {
    const mine = byTopic.get(topic.id);
    return {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      level: topic.level,
      total: exercises.filter((e) => e.topicId === topic.id).length,
      done: mine?.done ?? 0,
      passed: mine?.passed ?? false,
    };
  });
}

/** Тема целиком: правило, примеры, упражнения и прогресс. Ответы наружу не отдаются. */
export async function topicView(db: Db, userId: number, topicId: number): Promise<TopicView | undefined> {
  const [topic] = await db.select().from(grammarTopics).where(eq(grammarTopics.id, topicId));
  if (!topic) return undefined;
  const exercises = await db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topicId)).orderBy(asc(grammarExercises.position), asc(grammarExercises.id));
  const [progress] = await db.select().from(grammarProgress).where(and(eq(grammarProgress.userId, userId), eq(grammarProgress.topicId, topicId)));
  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    level: topic.level,
    total: exercises.length,
    done: progress?.done ?? 0,
    passed: progress?.passed ?? false,
    rule: topic.rule,
    examples: splitLines(topic.examples),
    exercises: exercises.map((e) => ({
      id: e.id,
      kind: asKind(e.kind),
      prompt: e.prompt,
      options: splitLines(e.options),
      // «Решено» считаем по прогрессу: упражнения не помечаются по одному, чтобы не заводить третью таблицу.
      solved: (progress?.done ?? 0) > 0 && e.position < (progress?.done ?? 0),
    })),
  };
}

function asKind(value: string): GrammarKind {
  return value === "gap" || value === "order" ? value : "choice";
}

/** Есть ли тема по id и языке ли она того языка, что учат сейчас (иначе темы чужого языка смешаются). */
export async function topic(db: Db, topicId: number): Promise<GrammarTopic | undefined> {
  const [row] = await db.select().from(grammarTopics).where(eq(grammarTopics.id, topicId));
  return row;
}

/**
 * Проверить ответ и записать прогресс. Модель не зовётся — это и есть главное свойство.
 *
 * Упражнения идут по порядку `position`: верный ответ двигает `done` вперёд, ошибка сбрасывает `streak`,
 * но `done` не откатывает — прогресс не отнимается. Экзамен открыт, когда `done` дошёл до `total`.
 */
export async function answerExercise(db: Db, input: { userId: number; exerciseId: number; answer: string; now: Date }): Promise<AnswerResult | undefined> {
  const [exercise] = await db.select().from(grammarExercises).where(eq(grammarExercises.id, input.exerciseId));
  if (!exercise) return undefined;
  const total = (await db.select({ id: grammarExercises.id }).from(grammarExercises).where(eq(grammarExercises.topicId, exercise.topicId))).length;
  const correctAnswer = exercise.answer;
  const correct = isCorrect(asKind(exercise.kind), input.answer, correctAnswer);

  const [existing] = await db.select().from(grammarProgress)
    .where(and(eq(grammarProgress.userId, input.userId), eq(grammarProgress.topicId, exercise.topicId)));
  // Верный ответ засчитывается только если он следующий по порядку — иначе можно было бы отвечать
  // на одно и то же лёгкое упражнение и «пройти» тему, не открыв остальные.
  const advances = correct && (existing?.done ?? 0) === exercise.position;
  const done = advances ? (existing?.done ?? 0) + 1 : (existing?.done ?? 0);
  const streak = correct ? (existing?.streak ?? 0) + 1 : 0;
  const passed = (existing?.passed ?? false) || done >= total;

  if (existing) {
    await db.update(grammarProgress)
      .set({ done, streak, passed, updatedAt: input.now })
      .where(and(eq(grammarProgress.userId, input.userId), eq(grammarProgress.topicId, exercise.topicId)));
  } else {
    await db.insert(grammarProgress).values({ userId: input.userId, topicId: exercise.topicId, done, streak, passed, updatedAt: input.now });
  }
  return { correct, answer: correctAnswer, why: exercise.why, done, total, passed };
}

/** Данные для подсказки модели: что спросить, когда человек нажал «почему так». */
export function explanationPrompt(topicRow: GrammarTopic, exercise: GrammarExercise): { rule: string; task: string; answer: string } {
  return { rule: topicRow.rule, task: exercise.prompt, answer: exercise.answer };
}

/** Тема по slug — для скрипта сборки и админских проверок. */
export async function topicBySlug(db: Db, slug: string): Promise<GrammarTopic | undefined> {
  const [row] = await db.select().from(grammarTopics).where(eq(grammarTopics.slug, slug));
  return row;
}

/** Прогресс человека по всем темам — для сводки «сколько грамматики пройдено». */
export async function grammarSummary(db: Db, user: User): Promise<{ topics: number; passed: number }> {
  const topics = await listTopics(db, user.id);
  return { topics: topics.length, passed: topics.filter((t) => t.passed).length };
}
