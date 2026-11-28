import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { grammarExercises, grammarProgress, grammarTopics, type GrammarExercise, type GrammarTopic } from "../db/schema";
import { recordMistakes } from "./mistakes";
import { recordStudyActivity } from "./study-activities";
import { getUser } from "./users";
import { bossEnabled } from "./boss";
import { GRAMMAR_TOPICS } from "../grammar";

/**
 * 📘 Грамматика: темы, упражнения и прогресс.
 *
 * Главное решение — **проверка ответа никогда не зовёт модель**. Упражнения собираются заранее скриптом
 * и лежат в базе вместе с правильным ответом, поэтому верность считается сравнением строк. Генерация
 * упражнений моделью нестабильна (в проекте она уже ходит через `RetryLater`), и человек не должен
 * упираться в «модель не ответила» посреди темы.
 *
 * Модель нужна только для дополнительного вопроса — там её сбой ничего не блокирует: правило уже
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
  /**
   * Варианты есть только у `choice`. У `gap` и `order` их нет намеренно: человек вспоминает форму
   * и пишет её сам.
   *
   * Раньше варианты собирались здесь же (`distractorsFor`) из правильного ответа — и получались
   * «works | worksing | workss». Два из трёх вариантов не существуют в языке, поэтому верный угадывался
   * без знания правила: упражнение тренировало не грамматику, а узнавание бессмыслицы. Для `order`
   * было то же самое — три готовых предложения целиком вместо сборки.
   */
  options?: string[];
  /**
   * Слова для сборки — только у `order`. Перемешаны на сервере: в контенте они записаны в правильном
   * порядке, и отдавать их как есть значило бы показывать ответ.
   */
  words?: string[];
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
  energy: number;
}

/**
 * Сокращения, которые считаются тем же ответом, что и полная запись.
 *
 * Словарь, а не цепочка регулярок: при заменах по порядку «won't» успевало превратиться в «wo not»
 * раньше, чем до него доходила своя замена. Здесь каждая форма перечислена целиком.
 *
 * «'s» намеренно не раскрывается: это и «is», и «has», и притяжательное — угадывать нельзя, иначе
 * верный ответ «John's car» совпал бы с неверным «John is car».
 */
const CONTRACTIONS: Record<string, string> = {
  "can't": "cannot", "cannot": "cannot",
  "won't": "will not",
  "shan't": "shall not",
  "i'm": "i am",
  "it's": "it is", "that's": "that is", "what's": "what is", "there's": "there is", "here's": "here is", "who's": "who is",
  "he's": "he is", "she's": "she is",
};

/** Раскрыть сокращение по правилу «основа + n't» → «основа not»: doesn't → does not. */
function expandContraction(token: string): string {
  const mapped = CONTRACTIONS[token];
  if (mapped) return mapped;
  // Порядок важен: сначала слова из словаря (they обрабатываются выше), потом общее правило.
  if (token.endsWith("n't")) return `${token.slice(0, -3)} not`;
  if (token.endsWith("'re")) return `${token.slice(0, -3)} are`;
  if (token.endsWith("'ve")) return `${token.slice(0, -3)} have`;
  if (token.endsWith("'ll")) return `${token.slice(0, -3)} will`;
  if (token === "'d" || token.endsWith("'d")) return `${token.slice(0, -2)} would`;
  return token;
}

/**
 * Приведение ответа к сравнимому виду.
 *
 * Человек теперь пишет форму сам, а не выбирает кнопку, поэтому прощается всё, что не относится
 * к проверяемому правилу:
 *
 * - регистр и лишние пробелы — «Works» и «  works » это верный ответ;
 * - типографские апострофы — на телефоне автозамена ставит «’» вместо «'», и «doesn’t» не должно
 *   считаться ошибкой в отрицании;
 * - сокращения — «does not» и «doesn't» проверяют одно и то же правило. Требовать ровно одну запись
 *   значило бы наказывать за форму записи, а не за грамматику;
 * - знаки препинания — запятая не является ответом на вопрос о форме глагола.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    // Типографские апострофы и тире к обычным: клавиатура телефона подставляет свои.
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    // Знаки препинания по краям не часть ответа.
    .replace(/[.,!?;:]+/g, " ")
    .split(/\s+/)
    .map(expandContraction)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

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
      // `choice` — единственный вид с готовыми вариантами из контента.
      options: asKind(e.kind) === "choice" ? splitLines(e.options) : undefined,
      // `order` — слова вперемешку, чтобы их надо было собрать, а не узнать готовое предложение.
      words: asKind(e.kind) === "order" ? shuffleWords(e.answer, e.id) : undefined,
      // «Решено» считаем по прогрессу: упражнения не помечаются по одному, чтобы не заводить третью таблицу.
      solved: (progress?.done ?? 0) > 0 && e.position < (progress?.done ?? 0),
    })),
  };
}

/**
 * Слова предложения в перемешанном порядке.
 *
 * Перемешивание детерминированное (от `id` упражнения), а не случайное: экран не должен перетасовываться
 * при каждом открытии, иначе человек, вернувшийся к упражнению, искал бы слова заново.
 *
 * Вырожденные случаи проверяются явно: при двух-трёх словах перестановка может совпасть с ответом,
 * и тогда «собери предложение» решалось бы одним нажатием.
 */
function shuffleWords(answer: string, seed: number): string[] {
  const words = answer.trim().split(/\s+/);
  // Детерминированный шаг: взаимно простой с длиной, чтобы обход покрыл все позиции.
  const step = [1, 2, 3, 5, 7].map((s) => s).find((s) => gcd(s, words.length) === 1) ?? 1;
  const start = seed % Math.max(words.length, 1);
  const shuffled = words.map((_, i) => words[(start + i * step) % words.length]);
  // Совпало с ответом — сдвигаем на одно слово: этого достаточно, а перемешивать заново не нужно.
  if (shuffled.join(" ") === words.join(" ")) shuffled.push(shuffled.shift() as string);
  return shuffled;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function asKind(value: string): GrammarKind {
  return value === "gap" || value === "order" ? value : "choice";
}

/** Есть ли тема по id и языке ли она того языка, что учат сейчас (иначе темы чужого языка смешаются). */
export async function topic(db: Db, topicId: number): Promise<GrammarTopic | undefined> {
  const [row] = await db.select().from(grammarTopics).where(eq(grammarTopics.id, topicId));
  return row;
}

export async function grammarExerciseWithTopic(db: Db, exerciseId: number) {
  const [row] = await db.select({ exercise: grammarExercises, topic: grammarTopics })
    .from(grammarExercises)
    .innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
    .where(eq(grammarExercises.id, exerciseId));
  return row;
}

/**
 * Проверить ответ и записать прогресс. Модель не зовётся — это и есть главное свойство.
 *
 * Упражнения идут по порядку `position`: верный ответ двигает `done` вперёд, ошибка сбрасывает `streak`,
 * но `done` не откатывает — прогресс не отнимается. Экзамен открыт, когда `done` дошёл до `total`.
 */
export async function answerExercise(
  db: Db,
  input: { userId: number; exerciseId: number; answer: string; now: Date; globalBossEnabled?: boolean },
): Promise<AnswerResult | undefined> {
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

  // Промах попадает в ту же работу над ошибками, что и ошибки из /check: категория темы совпадает с
  // названиями оттуда, поэтому в карточки подмешивается вместе с ними, а не отдельным списком.
  if (!correct) {
    const [topicRow] = await db.select().from(grammarTopics).where(eq(grammarTopics.id, exercise.topicId));
    await recordMistakes(db, input.userId, [{
      wrong: `${exercise.prompt} → ${input.answer}`,
      right: correctAnswer,
      why: exercise.why,
      category: topicRow?.category,
    }], input.now);
  }

  if (existing) {
    await db.update(grammarProgress)
      .set({ done, streak, passed, updatedAt: input.now })
      .where(and(eq(grammarProgress.userId, input.userId), eq(grammarProgress.topicId, exercise.topicId)));
  } else {
    await db.insert(grammarProgress).values({ userId: input.userId, topicId: exercise.topicId, done, streak, passed, updatedAt: input.now });
  }
  let energy = 0;
  if (correct) {
    const user = await getUser(db, input.userId);
    if (user) {
      const reward = bossEnabled(user, input.globalBossEnabled) ? 2 : 0;
      if (await recordStudyActivity(db, user, input.now, "grammar", String(exercise.id), reward)) energy = reward;
    }
  }
  return { correct, answer: correctAnswer, why: exercise.why, done, total, passed, energy };
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

/**
 * 📦 Залить темы из кода в базу — при старте бота, как миграции.
 *
 * Контент лежит в `src/grammar/`, поэтому деплой кода должен и обновлять темы: иначе человек
 * видел бы «тем нет» (или получал старые упражнения) до тех пор, пока кто-то вручную не запустит скрипт.
 * Пользователю такое сообщение показывать бессмысленно — он не может ничего сделать.
 *
 * Идемпотентно: тему с тем же slug обновляем, упражнения заменяем целиком. Прогресс по теме сбрасывается,
 * только если содержимое правда изменилось — иначе каждый перезапуск обнулял бы людям пройденное.
 */
export async function syncGrammar(db: Db, now: Date, only?: string[]): Promise<{ topics: number; exercises: number }> {
  let topics = 0;
  let exercises = 0;
  // `only` — залить отдельные темы (ручной скрипт); без него синхронизируется всё, как при старте бота.
  const selected = only?.length ? GRAMMAR_TOPICS.filter((t) => only.includes(t.slug)) : GRAMMAR_TOPICS;
  for (const [position, draft] of selected.entries()) {
    const [existing] = await db.select().from(grammarTopics).where(eq(grammarTopics.slug, draft.slug));
    const values = {
      slug: draft.slug,
      title: draft.title,
      level: draft.level,
      language: draft.language ?? "en",
      category: draft.category,
      rule: draft.rule,
      examples: draft.examples.join("\n"),
      position,
    };
    let topicId: number;
    if (existing) {
      await db.update(grammarTopics).set(values).where(eq(grammarTopics.id, existing.id));
      topicId = existing.id;
    } else {
      const [created] = await db.insert(grammarTopics).values({ ...values, createdAt: now }).returning();
      topicId = created.id;
    }
    // Сверяем упражнения с кодом: заменяем только при расхождении, иначе прогресс терялся бы впустую.
    const stored = await db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topicId)).orderBy(asc(grammarExercises.position));
    const wanted = draft.exercises.map((exercise, index) => ({
      topicId,
      kind: exercise.kind,
      prompt: exercise.prompt,
      options: (exercise.options ?? []).join("\n"),
      answer: exercise.answer,
      why: exercise.why,
      position: index,
    }));
    const same = stored.length === wanted.length && stored.every((row, i) => {
      const next = wanted[i];
      return row.kind === next.kind && row.prompt === next.prompt && row.options === next.options && row.answer === next.answer;
    });
    if (!same) {
      await db.delete(grammarExercises).where(eq(grammarExercises.topicId, topicId));
      if (wanted.length) await db.insert(grammarExercises).values(wanted);
      // Упражнения сменились — прежний прогресс к ним больше не относится.
      await db.update(grammarProgress).set({ done: 0, streak: 0, passed: false, updatedAt: now }).where(eq(grammarProgress.topicId, topicId));
    }
    topics += 1;
    exercises += wanted.length;
  }
  return { topics, exercises };
}
