/**
 * Проверка одного файла контента грамматики — без записи в базу и без правки `index.ts`.
 *
 * Нужна, когда тему пишут параллельно: `scripts/build-grammar.ts` проверяет весь набор сразу,
 * а здесь достаточно указать файл, чтобы поймать ошибки до того, как он попадёт в общий список.
 *
 *   npx tsx scripts/check-grammar-file.ts src/grammar/a1-extra.ts
 *
 * Проверяет то же, что и сборка (ответ среди вариантов, `___` в пропуске, слова `order` совпадают
 * с вариантами, `why` не пуст, категория из `/check`, вид упражнения известен), плюс то, чего сборка
 * не видит: долю `choice` и повторы вопросов внутри файла.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { ExerciseDraft, TopicDraft } from "../src/grammar/types";
import { MISTAKE_CATEGORIES } from "../src/llm/enricher";

const file = process.argv[2];
if (!file) {
  console.error("Укажи файл: npx tsx scripts/check-grammar-file.ts src/grammar/a1-extra.ts");
  process.exit(1);
}

const module = await import(pathToFileURL(resolve(file)).href) as Record<string, unknown>;
// Берём первый экспорт-массив тем: имена у файлов разные (`A1_TOPICS`, `B1_EXTRA`…).
const topics = Object.values(module).find((value): value is TopicDraft[] =>
  Array.isArray(value) && value.length > 0 && typeof (value[0] as TopicDraft)?.slug === "string");

if (!topics) {
  console.error(`${file}: не нашёл экспорт с массивом тем`);
  process.exit(1);
}

/** Служебные слова: их форма в пропуске однозначна, подсказка только мешала бы читать задание. */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "some", "any", "no", "much", "many", "few", "little", "lot",
  "in", "on", "at", "to", "for", "from", "with", "by", "of", "about", "into", "during", "until",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their",
]);

/**
 * Нужна ли подсказка в скобках. Нужна, если ответ — глагол или его форма: там человек должен видеть
 * исходную форму, иначе не знает, что от него хотят. Служебные слова проверяются без подсказки.
 */
function needsHint(exercise: ExerciseDraft): boolean {
  const first = exercise.answer.trim().toLowerCase().split(/\s+/)[0] ?? "";
  // Ответ из нескольких слов почти всегда глагольная группа: «have been», «does not work».
  if (exercise.answer.trim().split(/\s+/).length > 1) return true;
  const bare = first.replace(/[^a-z']/g, "");
  if (FUNCTION_WORDS.has(bare)) return false;
  return true;
}

const problems: string[] = [];
const seen = new Map<string, string>();

for (const topic of topics) {
  const at = topic.slug;
  if (!topic.rule.trim()) problems.push(`${at}: пустое правило`);
  if (!topic.examples.length) problems.push(`${at}: нет примеров`);
  if (!MISTAKE_CATEGORIES.includes(topic.category)) problems.push(`${at}: категория «${topic.category}» не из списка /check`);
  if (topic.exercises.length < 12) problems.push(`${at}: упражнений ${topic.exercises.length}, нужно 12–15`);

  // Доля выбора ограничена: остальное должно требовать вспомнить форму, а не узнать её.
  const choices = topic.exercises.filter((e) => e.kind === "choice").length;
  if (choices > Math.floor(topic.exercises.length / 2)) {
    problems.push(`${at}: choice ${choices} из ${topic.exercises.length} — больше половины, остальное должно быть gap и order`);
  }

  for (const [i, exercise] of topic.exercises.entries()) {
    const where = `${at}[${i}]`;
    check(exercise, where, problems);
    const key = exercise.prompt.trim().toLowerCase();
    const earlier = seen.get(key);
    if (earlier) problems.push(`${where}: вопрос повторяется (${earlier})`);
    seen.set(key, where);
  }

  // Пример из правила, повторённый в упражнении дословно, проверяет память, а не грамматику.
  for (const example of topic.examples) {
    const core = example.split("—")[0].trim().toLowerCase();
    if (core.length < 12) continue;
    for (const exercise of topic.exercises) {
      if (exercise.prompt.toLowerCase().includes(core)) {
        problems.push(`${at}: упражнение «${exercise.prompt}» дословно повторяет пример из правила`);
      }
    }
  }
}


function check(exercise: ExerciseDraft, at: string, problems: string[]): void {
  if (!exercise.answer.trim()) problems.push(`${at}: пустой ответ`);
  if (!exercise.why.trim()) problems.push(`${at}: нет объяснения — без него ошибка ничему не учит`);
  if (!exercise.prompt.trim()) problems.push(`${at}: пустой вопрос`);
  if (!["choice", "gap", "order"].includes(exercise.kind)) problems.push(`${at}: неизвестный вид «${exercise.kind}»`);

  if (exercise.kind === "choice") {
    const options = exercise.options ?? [];
    if (options.length < 2) problems.push(`${at}: у выбора меньше двух вариантов`);
    if (options.length > 4) problems.push(`${at}: у выбора больше четырёх вариантов — читать неудобно`);
    if (!options.includes(exercise.answer)) problems.push(`${at}: ответ «${exercise.answer}» не совпадает дословно ни с одним вариантом`);
    if (new Set(options).size !== options.length) problems.push(`${at}: варианты повторяются`);
    // Пропуск в выборе обязателен: иначе варианты некуда подставлять.
    if (!exercise.prompt.includes("___")) problems.push(`${at}: в выборе нет пропуска «___»`);
    // Варианты не должны быть заведомо разной длины с одним очевидно верным.
    if (options.some((o) => !o.trim())) problems.push(`${at}: пустой вариант`);
  }
  if (exercise.kind === "gap") {
    if (!exercise.prompt.includes("___")) problems.push(`${at}: в пропуске нет «___»`);
    if (exercise.options?.length) problems.push(`${at}: у вида gap не должно быть вариантов`);
    // Подсказка в скобках нужна там, где ответ иначе неоднозначен: человек должен знать, какую форму
    // глагола ставить («have» или «has»?). Для служебных слов — артикль, предлог, местоимение — подсказка
    // была бы шумом: «She's ___ teacher» с ответом «a» читается однозначно.
    // Подсказкой считаем и русскую ремарку в скобках: «(вопросительное слово не нужно)» снимает
    // неоднозначность не хуже инфинитива.
    if (needsHint(exercise) && !/\([^)]*\)/.test(exercise.prompt)) {
      problems.push(`${at}: в gap нет подсказки в скобках вида (work)`);
    }
  }
  if (exercise.kind === "order") {
    const words = exercise.options ?? [];
    if (words.length < 2) problems.push(`${at}: собирать нечего — меньше двух слов`);
    const answer = exercise.answer.trim().split(/\s+/);
    if (answer.length !== words.length || [...answer].sort().join(" ") !== [...words].sort().join(" ")) {
      problems.push(`${at}: слова ответа не совпадают со словами вариантов`);
    }
    if (!exercise.prompt.toLowerCase().includes("собери")) problems.push(`${at}: у order в вопросе нет «Собери»`);
  }
}

const total = topics.reduce((n, t) => n + t.exercises.length, 0);
if (problems.length) {
  console.error(`✗ ${file}: ${topics.length} тем, ${total} упражнений, проблем ${problems.length}:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ ${file}: ${topics.length} тем, ${total} упражнений — замечаний нет`);
