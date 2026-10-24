/**
 * Собирает готовые наборы слов (📦 в приложении): по уровням — из частотных списков wordfreq, по темам — списком от модели.
 * Модель отбирает полезное и приводит к словарной форме, карточки готовит как /text (перевод, пример, транскрипция),
 * полезность — по тем же правилам. Наборы с тем же slug заменяются целиком.
 *   npx tsx scripts/build-sets.ts                — все наборы
 *   npx tsx scripts/build-sets.ts b1 idioms      — только эти
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { createDb } from "../src/db/client";
import { jsonArray } from "../src/llm/json";
import { ClaudeCodeEnricher } from "../src/llm/claude-code";
import { WordfreqSource } from "../src/frequency/frequency";
import { rateUsefulness } from "../src/services/usefulness";
import { replaceSet } from "../src/services/word-sets";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const SET_SIZE = 100;
const BATCH = 25;

interface LevelSpec {
  slug: string;
  title: string;
  description: string;
  kind: "level";
  /** Диапазон рангов частотности (wordfreq top_n_list), откуда отбираем слова. */
  ranks: [number, number];
  level: string;
}

interface TopicSpec {
  slug: string;
  title: string;
  description: string;
  kind: "topic";
  /** Что просить у модели. */
  ask: string;
}

const SETS: Array<LevelSpec | TopicSpec> = [
  { slug: "a1", title: "A1 · Начальный", description: "Самые базовые слова повседневной жизни", kind: "level", ranks: [0, 1500], level: "A1" },
  { slug: "a2", title: "A2 · Элементарный", description: "Частые слова для простых разговоров", kind: "level", ranks: [1500, 3000], level: "A2" },
  { slug: "b1", title: "B1 · Средний", description: "Слова, чтобы свободно говорить на бытовые темы", kind: "level", ranks: [3000, 6000], level: "B1" },
  { slug: "b2", title: "B2 · Выше среднего", description: "Для фильмов, новостей и работы", kind: "level", ranks: [6000, 12000], level: "B2" },
  { slug: "c1", title: "C1 · Продвинутый", description: "Богатый словарь: оттенки и книжные слова", kind: "level", ranks: [12000, 25000], level: "C1" },
  { slug: "phrasal", title: "Фразовые глаголы", description: "Самые нужные: give up, figure out, run into…", kind: "topic", ask: "самые употребительные фразовые глаголы английского (give up, figure out, run into, put off…), в основном значении" },
  { slug: "idioms", title: "Идиомы на каждый день", description: "Те, что правда говорят: cut to the chase, a piece of cake…", kind: "topic", ask: "идиомы и устойчивые выражения, которые носители реально часто используют в разговоре сегодня (не устаревшие и не книжные)" },
  { slug: "travel", title: "Путешествия", description: "Аэропорт, отель, дорога, в городе", kind: "topic", ask: "слова и фразы для путешествий: аэропорт, перелёт, отель, транспорт, ориентирование в городе, ресторан, покупки, проблемы в поездке" },
  { slug: "work", title: "Работа и офис", description: "Встречи, письма, задачи, коллеги", kind: "topic", ask: "слова и фразы для работы в офисе и на созвонах: встречи, письма, дедлайны, задачи, обсуждения, отношения с коллегами и руководителем" },
  { slug: "it", title: "IT и разработка", description: "Для работы в IT-команде", kind: "topic", ask: "слова и фразы, которые нужны разработчику в англоязычной команде: код-ревью, баги, релизы, архитектура, созвоны, тикеты (не только термины, но и как об этом говорят)" },
  { slug: "slang", title: "Разговорный и из сериалов", description: "Как говорят в жизни и в кино", kind: "topic", ask: "разговорные слова и выражения из современных сериалов и живой речи (британской и американской): сленг, усилители, реакции, фразы-связки; без грубой нецензурщины" },
];

const terms = z.array(z.string().trim().min(1));

const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 180_000, mnemonicModel: "sonnet" });
const frequency = new WordfreqSource(process.env.WORDFREQ_PYTHON || "tools/wordfreq/.venv/bin/python", "tools/wordfreq/zipf.py");
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });

/** Список слов набора: для уровня — отбор из частотного диапазона, для темы — от модели. */
async function pickTerms(spec: LevelSpec | TopicSpec): Promise<string[]> {
  const common = [
    `Верни JSON-массив из ${SET_SIZE} строк — английских слов или фраз в словарной форме (глаголы — без to, существительные — в единственном числе), без повторов,`,
    "от более полезного к менее полезному. Только массив, без пояснений.",
  ];
  if (spec.kind === "topic") {
    return terms.parse(jsonArray(await claude.ask([`Составь набор для изучения английского русскоязычным человеком: ${spec.ask}.`, ...common].join("\n"), 180_000, "sonnet")));
  }
  const all = JSON.parse(execFileSync("tools/wordfreq/.venv/bin/python", ["tools/wordfreq/top.py", String(spec.ranks[1])], { encoding: "utf8" })) as string[];
  const pool = all.slice(spec.ranks[0]).filter((w) => /^[a-z][a-z'-]{2,}$/.test(w));
  return terms.parse(
    jsonArray(
      await claude.ask(
        [
          `Ниже английские слова из частотного диапазона, который соответствует уровню ${spec.level}. Выбери ${SET_SIZE} самых полезных для русскоязычного человека на этом уровне.`,
          "Пропусти служебные слова, имена и названия, аббревиатуры, слишком узкие термины и слишком лёгкие для этого уровня слова.",
          "Формы приводи к словарной (went → go, cars → car) и не повторяй одно слово в разных формах.",
          ...common,
          "",
          pool.join(", "),
        ].join("\n"),
        240_000,
        "sonnet",
      ),
    ),
  );
}

async function build(spec: LevelSpec | TopicSpec, position: number): Promise<void> {
  const started = Date.now();
  const list = (await pickTerms(spec)).slice(0, SET_SIZE);
  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
  // Карточки — как для списка в /text: каждый пункт с переводом, примером и транскрипцией.
  const enriched = (await Promise.all(batches.map((b) => claude.extract(b.join("\n")).catch((err) => (console.error(spec.slug, "batch failed", err), []))))).flat();
  const rated = await rateUsefulness(enriched, frequency);
  const count = await replaceSet(
    db,
    { slug: spec.slug, title: spec.title, kind: spec.kind, description: spec.description, position },
    rated.map((w) => ({
      term: w.term,
      translation: w.translation,
      explanation: w.explanation,
      example: w.example,
      transcriptionUk: w.transcriptionUk ?? "",
      transcriptionUs: w.transcriptionUs ?? "",
      usefulness: w.usefulness ?? null,
      usefulnessNote: w.usefulnessNote ?? "",
    })),
    new Date(),
  );
  console.log(`${spec.slug}: ${count} words in ${Math.round((Date.now() - started) / 1000)} s`);
}

const only = process.argv.slice(2);
for (const [i, spec] of SETS.entries()) {
  if (only.length && !only.includes(spec.slug)) continue;
  try {
    await build(spec, i);
  } catch (err) {
    console.error(`${spec.slug}: failed`, err);
  }
}
