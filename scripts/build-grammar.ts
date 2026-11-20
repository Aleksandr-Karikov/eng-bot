/**
 * Загружает темы грамматики из `src/grammar-content.ts` в базу.
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
import { GRAMMAR_TOPICS, type ExerciseDraft, type TopicDraft } from "../src/grammar-content";
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
const now = new Date();

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
    // Упражнения заменяются целиком: прогресс по этой теме сбрасывается, но строка прогресса остаётся,
    // иначе после правки контента экзамен оказался бы сдан по старым упражнениям.
    await db.update(grammarProgress).set({ done: 0, streak: 0, passed: false, updatedAt: now }).where(eq(grammarProgress.topicId, topicId));
    await db.delete(grammarExercises).where(eq(grammarExercises.topicId, topicId));
  } else {
    const [created] = await db.insert(grammarTopics).values({ ...values, createdAt: now }).returning();
    topicId = created.id;
  }
  await db.insert(grammarExercises).values(draft.exercises.map((exercise, index) => ({
    topicId,
    kind: exercise.kind,
    prompt: exercise.prompt,
    options: (exercise.options ?? []).join("\n"),
    answer: exercise.answer,
    why: exercise.why,
    position: index,
  })));
  console.log(`  ✓ ${draft.slug}: ${draft.exercises.length} упражнений`);
}

console.log("Готово. Темы в боте: /grammar");
