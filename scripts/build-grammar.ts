/**
 * Загружает темы грамматики из `src/grammar/` в базу.
 *
 * Контент ручной: скрипт ничего не генерирует, он только проверяет и заливает. Проверки обязательны —
 * упражнения проверяются сравнением строк, поэтому ошибка в контенте означает «человек ответил верно,
 * а бот сказал неверно». Такое лучше падать здесь, чем на живом пользователе.
 *
 *   npx tsx scripts/build-grammar.ts             — залить все темы
 *   npx tsx scripts/build-grammar.ts --dry-run   — только проверить контент
 *   npx tsx scripts/build-grammar.ts articles    — только одну тему
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { grammarExercises, grammarProgress, grammarTopics } from "../src/db/schema";
import { GRAMMAR_TOPICS, type ExerciseDraft, type TopicDraft } from "../src/grammar";
import { syncGrammar } from "../src/services/grammar-topics";
import { MISTAKE_CATEGORIES } from "../src/llm/enricher";

const dryRun = process.argv.includes("--dry-run");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Ошибка в контенте: собираем все и падаем разом, чтобы не чинить по одной. */
function validate(topics: TopicDraft[]): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  for (const topic of topics) {
    if (slugs.has(topic.slug)) problems.push(`${topic.slug}: повторяющийся slug`);
    slugs.add(topic.slug);
    if (!topic.rule.trim()) problems.push(`${topic.slug}: пустое правило`);
    // Категория должна совпадать с /check, иначе промахи темы не попадут в общую работу над ошибками.
    if (!MISTAKE_CATEGORIES.includes(topic.category)) problems.push(`${topic.slug}: категория «${topic.category}» не из списка /check`);
    if (topic.exercises.length === 0) problems.push(`${topic.slug}: нет упражнений`);
    const prompts = new Set<string>();
    topic.exercises.forEach((exercise, i) => {
      const at = `${topic.slug}[${i}]`;
      check(exercise, at, problems);
      // Один и тот же вопрос дважды в теме — почти всегда копипаста, а не замысел.
      if (prompts.has(exercise.prompt)) problems.push(`${at}: повторяющийся вопрос`);
      prompts.add(exercise.prompt);
    });
  }
  // Повтор вопроса МЕЖДУ темами — тоже ошибка: человек, проходящий подряд, увидит одно и то же дважды,
  // а проверка ответа не заметит, что это дубль из соседней темы.
  const seen = new Map<string, string>();
  for (const topic of topics) {
    for (const exercise of topic.exercises) {
      const key = exercise.prompt.trim().toLowerCase();
      const where = seen.get(key);
      if (where && where !== topic.slug) problems.push(`${topic.slug}: вопрос повторяется из темы «${where}»`);
      seen.set(key, topic.slug);
    }
  }
  return problems;
}

function check(exercise: ExerciseDraft, at: string, problems: string[]): void {
  if (!exercise.answer.trim()) problems.push(`${at}: пустой ответ`);
  if (!exercise.why.trim()) problems.push(`${at}: нет объяснения — без него ошибка ничему не учит`);
  if (exercise.kind === "choice") {
    const options = exercise.options ?? [];
    if (options.length < 2) problems.push(`${at}: у выбора меньше двух вариантов`);
    if (!options.includes(exercise.answer)) problems.push(`${at}: ответ «${exercise.answer}» не совпадает дословно ни с одним вариантом`);
    if (new Set(options).size !== options.length) problems.push(`${at}: варианты повторяются`);
  }
  if (exercise.kind === "gap") {
    if (!exercise.prompt.includes("___")) problems.push(`${at}: в пропуске нет «___»`);
    if (exercise.options?.length) problems.push(`${at}: у вида gap не должно быть вариантов`);
  }
  if (exercise.kind === "order") {
    const words = exercise.options ?? [];
    if (words.length < 2) problems.push(`${at}: собирать нечего — меньше двух слов`);
    // Слова из ответа должны быть теми же, что в вариантах: иначе задание невыполнимо.
    const answer = exercise.answer.trim().split(/\s+/);
    if (answer.length !== words.length || [...answer].sort().join(" ") !== [...words].sort().join(" ")) {
      problems.push(`${at}: слова ответа не совпадают со словами вариантов`);
    }
  }
  if (!["choice", "gap", "order"].includes(exercise.kind)) problems.push(`${at}: неизвестный вид «${exercise.kind}»`);
}

const selected = only.length ? GRAMMAR_TOPICS.filter((t) => only.includes(t.slug)) : GRAMMAR_TOPICS;
if (only.length && selected.length !== only.length) {
  const found = new Set(selected.map((t) => t.slug));
  for (const slug of only) if (!found.has(slug)) console.error(`Нет такой темы: ${slug}`);
  process.exit(1);
}

const problems = validate(selected);
if (problems.length) {
  console.error(`Контент не прошёл проверку (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`Тем: ${selected.length}, упражнений: ${selected.reduce((n, t) => n + t.exercises.length, 0)}${dryRun ? " (dry run)" : ""}`);
if (dryRun) process.exit(0);

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
// Запись — та же функция, что зовёт бот при старте: одна логика на всех, иначе скрипт и старт
// расходились бы в том, как обновлять темы и когда сбрасывать прогресс.
const synced = await syncGrammar(db, new Date(), only.length ? only : undefined);
console.log(`Готово: ${synced.topics} тем, ${synced.exercises} упражнений.`);
