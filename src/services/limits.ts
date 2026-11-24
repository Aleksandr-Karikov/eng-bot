import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { dailySpend, usageCounters } from "../db/schema";
import { localParts } from "../time";

/**
 * Лимиты на тяжёлые операции: сколько раз человек может сделать что-то за период.
 *
 * Зачем: на старте доступ полный, но отдельный человек не должен выесть ключ. Дороже всего картинки
 * и вызовы модели, поэтому ограничиваем их точечно, а не «всё подряд» (см. docs/limits.md).
 *
 * Устройство намеренно простое: одна таблица `usage_counters` с ключом (человек, период, вид), а не
 * подсчёт по существующим таблицам: считать по ним — значит писать отдельный запрос на каждый лимит
 * и зависеть от того, что записи вообще создаются.
 *
 * **Считается только успешно начатая операция, отказ счётчик не трогает.** Это важно для `image_redraw`:
 * если бы отказ считался, человек, нажавший кнопку десять раз, «израсходовал» бы лимит, не получив
 * ни одной картинки, и после сброса периода начинал бы со счётом больше нуля. Защита от злоупотребления
 * здесь не нужна: за отказом не стоит ни вызова модели, ни денег.
 */

/**
 * Что именно ограничиваем. Список закрытый: опечатка в строке иначе тихо создаст новый счётчик.
 *
 * Тяжёлые команды (`/check`, `/talk`…) идут сюда же, но у каждой **свой** лимит и своё сообщение:
 * «100 запросов в час на всё» человек не понимает и злится, а «5 разборов разговора в день» понимает.
 *
 * `add_word_week` — отдельный вид, а не второй период у `add_word`: ключ счётчика включает вид, поэтому
 * «50 в день» и «200 в неделю» — две независимые строки. Так человек, исчерпавший дневной лимит, не
 * съедает недельный, и наоборот. Недельный лимит проверяется вместе с дневным, одним решением.
 */
export type QuotaKind =
  | "inline_translate"
  | "explain"
  | "image"
  | "image_redraw"
  | "add_word"
  | "add_word_week"
  | "draft"
  | "read_image"
  | "check"
  | "talk"
  | "translate"
  | "story"
  | "say"
  | "drill"
  | "text"
  | "pron"
  | "audio";

export type QuotaPeriod = "day" | "week";

export interface Quota {
  kind: QuotaKind;
  period: QuotaPeriod;
  /** Сколько раз за период можно. */
  limit: number;
  /** Что сказать человеку, когда лимит исчерпан. Коротко и по делу, без «попробуйте позже». */
  refusal: string;
  /**
   * Считать по объекту, а не по человеку целиком. `word` — у каждого слова свои попытки.
   * Без этого «3 перерисовки» означали бы «3 на все слова», и второе слово осталось бы без картинки.
   */
  per?: "word";
}

/**
 * Квоты на время запуска. Тарифов пока нет; исключения для объяснений — в capture.ts.
 *
 * `inline_translate` — перевод нового слова прямо из инлайн-режима: человек написал `@бот слово`,
 * слова нет в словарях, и бот зовёт модель. Это единственный вызов модели, доступный **незнакомому**
 * человеку, поэтому лимит здесь обязателен: иначе `@бот` в чужом чате — бесплатный доступ к ключу.
 */
export const QUOTAS: Record<QuotaKind, Quota> = {
  inline_translate: {
    kind: "inline_translate",
    period: "day",
    limit: 30,
    refusal: "На сегодня хватит переводов (30). Продолжим завтра, а пока — добавь слово в словарь и повторяй его.",
  },
  explain: {
    kind: "explain",
    period: "day",
    limit: 30,
    refusal: "Разборов фраз на сегодня достаточно. Продолжим завтра.",
  },
  image: {
    kind: "image",
    period: "day",
    limit: 10,
    refusal: "Картинок на сегодня достаточно (10). Новые будут завтра.",
  },
  image_redraw: {
    kind: "image_redraw",
    period: "day",
    limit: 3,
    per: "word",
    refusal: "Эту картинку уже перерисовывали 3 раза. Попробуй другую — или оставь как есть.",
  },
  add_word: {
    kind: "add_word",
    period: "day",
    limit: 50,
    refusal: "Слов на сегодня достаточно (50). Сначала повтори то, что уже есть, — /learn.",
  },
  add_word_week: {
    kind: "add_word_week",
    period: "week",
    limit: 200,
    // Недельный лимит — не про деньги, а про качество: 200 слов за неделю человек всё равно не выучит,
    // а 500 просроченных карточек в первый же день заставляют уйти. Отказ объясняет, что делать.
    refusal: "На этой неделе уже 200 слов — это много. Повтори то, что добавил, — /learn; новые слова продолжим в понедельник.",
  },
  /**
   * Черновик слова: перевод, транскрипция и запоминалка от модели **до** сохранения.
   *
   * Отдельный вид, а не `add_word`, по двум причинам. Первая: черновик можно посмотреть и передумать —
   * и человек не должен за это терять место в дневном лимите слов. Вторая: без своего счётчика
   * `prepare` зовёт модель, но ничего не записывает, поэтому цикл по разным словам даёт неограниченные
   * платные вызовы. Квота на черновики закрывает ровно эту дыру, не мешая добавлению: сохранил слово —
   * тратится `add_word`, посмотрел и ушёл — только `draft`.
   */
  draft: {
    kind: "draft",
    period: "day",
    limit: 60,
    refusal: "Черновиков на сегодня достаточно (60). Добавь то, что уже подготовил, — а новые продолжим завтра.",
  },
  /**
   * Распознавание области экрана в расширении: vision-вызов по картинке до 4 МБ.
   *
   * Дороже любого текстового разбора за штуку, и раньше не считался вовсе — при утёкшем ключе
   * расширения это был бы неограниченный доступ к модели. Ключ к тому же едет в query строке,
   * а `/ext/*` проксируется наружу.
   */
  read_image: {
    kind: "read_image",
    period: "day",
    limit: 40,
    refusal: "Распознаваний области на сегодня достаточно (40). Продолжим завтра.",
  },
  // --- Тяжёлые команды. Лимиты намеренно щедрые: их задача — остановить накрутку, а не учёбу. ---
  check: {
    kind: "check",
    period: "day",
    limit: 30,
    // Самый частый вызов модели: /check висит на ответе, им можно проверять каждую фразу.
    refusal: "Проверок на сегодня достаточно (30). Ты молодец — вернёмся к этому завтра.",
  },
  talk: {
    kind: "talk",
    period: "day",
    limit: 5,
    // Считается разговор, а не реплика: внутри одного разговора модель зовётся десятки раз.
    refusal: "На сегодня разговоров достаточно (5). Завтра продолжим — или потренируй перевод, /translate.",
  },
  translate: {
    kind: "translate",
    period: "day",
    limit: 20,
    refusal: "Переводов на сегодня достаточно (20). Завтра продолжим — а пока повтори карточки, /learn.",
  },
  story: {
    kind: "story",
    period: "day",
    limit: 10,
    refusal: "Историй на сегодня достаточно (10). Завтра сочиним ещё.",
  },
  say: {
    kind: "say",
    period: "day",
    limit: 30,
    refusal: "На сегодня хватит разборов фраз (30). Завтра продолжим.",
  },
  drill: {
    kind: "drill",
    period: "day",
    limit: 10,
    refusal: "Дополнительных вопросов на сегодня достаточно (10). Обычная тренировка /learn работает без ограничений.",
  },
  text: {
    kind: "text",
    period: "day",
    limit: 5,
    // Самый дорогой текстовый путь: один разбор — до 100 слов, то есть $0.04 за раз.
    refusal: "На сегодня текстов достаточно (5). Разбери то, что уже добавил, — а остальное завтра.",
  },
  pron: {
    kind: "pron",
    period: "day",
    limit: 20,
    // Считается проверка голосового: распознавание идёт у внешнего провайдера и стоит денег.
    refusal: "Проверок произношения на сегодня достаточно (20). Потренируйся завтра — послушать диктора можно и сейчас.",
  },
  audio: {
    kind: "audio",
    period: "day",
    limit: 60,
    // Синтез локальный и бесплатный, но грузит CPU; лимит — предохранитель, а не экономия.
    refusal: "Озвучки на сегодня достаточно (60). Завтра продолжим.",
  },
};

/** Период в виде строки: день «2026-10-27» по поясу человека, неделя «2026-W43» (ISO). */
export function periodKey(period: QuotaPeriod, timeZone: string, now: Date): string {
  const { date } = localParts(timeZone, now);
  if (period === "day") return date;
  return weekKey(date);
}

/** ISO-неделя «2026-W43» из локальной даты. Считается по календарю, без Date — чтобы не зависеть от пояса. */
function weekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Четверг той же недели определяет её номер по ISO: неделя принадлежит году своего четверга.
  const thursday = new Date(Date.UTC(y, m - 1, d));
  const dayNum = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNum);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Ключ объекта для лимита «на слово»: `word:123`. Для лимитов на человека — пустая строка.
 *
 * Слово входит в ключ, поэтому лимит на слово не нужен ни в `QUOTAS`, ни в вызове: он виден из `kind`.
 * Если у лимита `per: "word"`, а id слова не передан — это ошибка вызова, и лучше упасть громко:
 * молча посчитать по человеку значит отдать чужой лимит.
 */
function scopeOf(quota: Quota, wordId?: number): string {
  if (quota.per !== "word") return "";
  if (wordId === undefined) throw new Error(`Лимиту ${quota.kind} нужен id слова`);
  return `word:${wordId}`;
}

export interface QuotaState {
  /** Можно ли выполнить операцию. */
  allowed: boolean;
  /** Сколько уже сделано за период (до этой попытки). */
  used: number;
  limit: number;
  /** Что сказать при отказе. */
  refusal: string;
}

/** Сколько уже израсходовано — без записи. Нужно там, где важно показать остаток, а не потратить. */
export async function quotaUsed(
  db: Db,
  input: { userId: number; kind: QuotaKind; timeZone: string; now: Date; wordId?: number },
): Promise<number> {
  const quota = QUOTAS[input.kind];
  const period = periodKey(quota.period, input.timeZone, input.now);
  const scope = scopeOf(quota, input.wordId);
  const [row] = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, input.userId),
        eq(usageCounters.period, period),
        eq(usageCounters.kind, input.kind),
        eq(usageCounters.scope, scope),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Проверить лимит и, если можно, сразу записать попытку.
 *
 * Проверка и запись — **одна** инструкция, а не «прочитал, потом записал». Раньше здесь читался
 * счётчик, и только потом шёл инкремент: между ними оставался `await`, за который проходили
 * параллельные вызовы. Это не теория — замер на тридцати одновременных вызовах при лимите 10 давал
 * «разрешено 30, счётчик 30». Путь реальный: `drawAndSend` и `/check` работают в `background()`,
 * а Mini App приходит отдельными HTTP-запросами, поэтому обработчики друг друга не ждут.
 *
 * Теперь `ON CONFLICT … DO UPDATE SET count = count + 1 WHERE count < :limit` — обычный
 * `DO UPDATE … WHERE`, который есть и в SQLite, и в Postgres, поэтому инвариант переносимости цел.
 * Если условие не выполнено, `UPDATE` не срабатывает и `returning()` не возвращает строк — это и есть
 * отказ. Счётчик при отказе не растёт, как и раньше.
 *
 * `limit <= 0` проверяется отдельно: при нулевом лимите вставки новой строки быть не должно
 * (`VALUES count = 1` не проходит через `WHERE` у `UPDATE`), иначе админский `/explainlimit 0`
 * открывал бы ровно одну попытку вместо запрета.
 */
export async function checkAndCount(
  db: Db,
  input: { userId: number; kind: QuotaKind; timeZone: string; now: Date; wordId?: number; limit?: number },
): Promise<QuotaState> {
  const quota = QUOTAS[input.kind];
  const limit = input.limit ?? quota.limit;
  const refusal = { allowed: false, limit, refusal: quota.refusal } as const;
  if (limit <= 0) return { ...refusal, used: 0 };

  const period = periodKey(quota.period, input.timeZone, input.now);
  const scope = scopeOf(quota, input.wordId);
  const key = { userId: input.userId, period, kind: input.kind, scope };

  const [written] = await db
    .insert(usageCounters)
    .values({ ...key, count: 1, updatedAt: input.now })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period, usageCounters.kind, usageCounters.scope],
      set: { count: sql`${usageCounters.count} + 1`, updatedAt: input.now },
      setWhere: sql`${usageCounters.count} < ${limit}`,
    })
    .returning({ count: usageCounters.count });

  // Условие не выполнено — значит, лимит уже выбран. Строку не пишем и попытку не тратим.
  if (!written) {
    return { ...refusal, used: await quotaUsed(db, input) };
  }
  // `used` — сколько стало после этой попытки (счётчик в базе уже включает её). Так его и читают
  // `quotaLine` и `/status`: «сделано 5 из 30», а не «было 4».
  return { allowed: true, used: written.count, limit, refusal: quota.refusal };
}

/**
 * Подписи видов для человека. Хранятся здесь, рядом с лимитами: `/status` печатает строку на каждый
 * вид из `QUOTAS`, и без подписи админ увидел бы `inline_translate` вместо «Перевод в инлайне».
 */
const QUOTA_NAMES: Record<QuotaKind, string> = {
  inline_translate: "Перевод в инлайне",
  explain: "Объяснения в расширении",
  image: "Картинки к словам",
  image_redraw: "Перерисовки",
  add_word: "Новые слова",
  add_word_week: "Новые слова за неделю",
  draft: "Черновики слов",
  read_image: "Распознавание области",
  check: "Проверки текста",
  talk: "Разборы разговора",
  translate: "Переводы",
  story: "Истории",
  say: "Проговорить",
  drill: "Дриллы",
  text: "Разбор текста",
  pron: "Произношение",
  audio: "Озвучка",
};

/** Строка «5 из 30» — для /status и там, где человеку важно видеть остаток. */
export function quotaLine(kind: QuotaKind, used: number): string {
  const quota = QUOTAS[kind];
  const unit = quota.period === "day" ? "сегодня" : "на этой неделе";
  const what = quota.per === "word" ? "на это слово" : "на человека";
  return `${QUOTA_NAMES[kind]}: ${used} из ${quota.limit} ${unit}, ${what}`;
}

/**
 * Два счётчика, которые образуют ОДНО правило про слова: «50 в день И 200 в неделю».
 *
 * Список один на весь файл: его читают отображение (`wordsLeft`), проверка (`checkAndCountWord`) и
 * подготовка строк (`ensureWordCounters`). Раньше формула была выписана в трёх местах отдельно, и они
 * могли разойтись: человек видел бы один остаток, а отказ приходил бы по другому числу (E25).
 */
const WORD_QUOTAS = ["add_word", "add_word_week"] as const;
type WordQuotaKind = (typeof WORD_QUOTAS)[number];

/** Период и предел каждого из двух счётчиков — тоже из одного места. */
function wordQuota(kind: WordQuotaKind): { period: QuotaPeriod; limit: number } {
  const quota = QUOTAS[kind];
  return { period: quota.period, limit: quota.limit };
}

/**
 * Сколько новых слов человек может добавить прямо сейчас — по дневному и недельному лимитам вместе.
 *
 * Два счётчика, а решение одно: показать остаток нужно там, где меньше запас, иначе человек увидит
 * «можно ещё 40», упрётся в недельный лимит на третьем слове и решит, что бот врёт.
 *
 * Это единственное место, где остаток **показывается**. Проверка (`checkAndCountWord`) считает то же
 * правило по-своему — в SQL, одной инструкцией, — но берёт имена счётчиков и пределы из `WORD_QUOTAS`,
 * поэтому разойтись они могут только вместе с этим списком.
 */
export async function wordsLeft(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<{ left: number; kind: QuotaKind; used: number; limit: number }> {
  const used = await Promise.all(WORD_QUOTAS.map((kind) => quotaUsed(db, { ...input, kind })));
  const [day, week] = WORD_QUOTAS.map((kind, i) => ({
    left: wordQuota(kind).limit - used[i],
    kind: kind as QuotaKind,
    used: used[i],
    limit: wordQuota(kind).limit,
  }));
  // Показываем тот лимит, который кончится раньше: иначе «можно ещё 40» упирается в недельный на третьем.
  return week.left < day.left ? week : day;
}

/**
 * Проверить дневной и недельный лимиты на слова и, если оба позволяют, записать по попытке в каждый.
 *
 * Отказ **ничего** не считает: если упёрся недельный, дневной счётчик тоже не растёт — иначе человек
 * сжигал бы дневной запас на отказах и после понедельника начинал бы день с нуля доступных слов.
 *
 * Раньше здесь были чтение обоих счётчиков и две независимые записи через `Promise.all`: между чтением
 * и записью оставался `await`, поэтому два параллельных добавления при остатке 1 могли оба пройти (E24).
 *
 * Как устроено теперь — два шага, и считает только второй:
 *
 * 1. `ensureWordCounters` идемпотентно заводит обе строки со счётчиком 0 (`ON CONFLICT DO NOTHING`).
 *    Это не расход и не решение — если места нет, счётчики просто останутся нулевыми.
 * 2. Один `UPDATE` обеих строк с общим гейтом `WITH … AS MATERIALIZED`, который проверяет **оба**
 *    предела сразу. Либо обе строки получают +1, либо ни одна: гейт вычисляется до записи, и
 *    `RETURNING` показывает, какие строки изменились.
 *
 * Почему не одной инструкцией `INSERT … ON CONFLICT … WHERE`: `DO UPDATE … WHERE` не действует на
 * **вставку** — отсутствующая строка появлялась бы, не спросив условие. Проверено пробой: при
 * исчерпанном недельном дневная строка вставлялась со счётчиком 1. Шаг `ensure` убирает этот случай.
 *
 * Почему `MATERIALIZED` обязателен: без него SQLite пересчитывает подзапрос для каждой строки уже
 * после первой записи, и вторая видит изменённое значение. Проверено: без материализации на границе
 * (49/199) проходила только одна строка.
 *
 * Переносимость сохранена: `WITH … MATERIALIZED`, `INSERT … ON CONFLICT DO NOTHING`, `UPDATE … RETURNING`
 * есть и в SQLite, и в Postgres. `db.transaction` не нужен.
 */
export async function checkAndCountWord(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<QuotaState> {
  const day = QUOTAS.add_word;
  const week = QUOTAS.add_word_week;
  // Периоды и пределы — из `wordQuota`, того же источника, что у `wordsLeft`: иначе отображение
  // и проверка могут разойтись, показывая остаток по одному лимиту и отказывая по другому.
  const dayPeriod = periodKey(wordQuota("add_word").period, input.timeZone, input.now);
  const weekPeriod = periodKey(wordQuota("add_word_week").period, input.timeZone, input.now);
  await ensureWordCounters(db, { ...input, dayPeriod, weekPeriod });

  /** Значение счётчика; отсутствующая строка считается нулём. */
  const counter = (period: string, kind: QuotaKind) => sql`coalesce((
    SELECT p.count FROM usage_counters p
    WHERE p.user_id = ${input.userId} AND p.period = ${period} AND p.kind = ${kind} AND p.scope = ''
  ), 0)`;
  // Гейт — материализованный подзапрос: SQLite без `MATERIALIZED` пересчитывает его для каждой
  // обновляемой строки уже после первой записи, и вторая видит изменённое значение.
  const gate = sql`(SELECT g.ok FROM (WITH g AS MATERIALIZED (
    SELECT (${counter(dayPeriod, "add_word")} < ${day.limit}
      AND ${counter(weekPeriod, "add_word_week")} < ${week.limit}) AS ok
  ) SELECT ok FROM g) AS g)`;

  const written = await db
    .update(usageCounters)
    .set({ count: sql`${usageCounters.count} + 1`, updatedAt: input.now })
    .where(and(
      eq(usageCounters.userId, input.userId),
      eq(usageCounters.scope, ""),
      sql`${gate}`,
      sql`((${usageCounters.period} = ${dayPeriod} AND ${usageCounters.kind} = 'add_word') OR (${usageCounters.period} = ${weekPeriod} AND ${usageCounters.kind} = 'add_word_week'))`,
    ))
    .returning({ kind: usageCounters.kind, count: usageCounters.count });

  const dayRow = written.find((row) => row.kind === "add_word");
  const weekRow = written.find((row) => row.kind === "add_word_week");
  // Обе строки прошли — попытка засчитана. Иначе не прошла ни одна.
  if (dayRow && weekRow) return { allowed: true, used: dayRow.count, limit: day.limit, refusal: day.refusal };

  // Отказ: `returning` не говорит, какой предел упёрся, а человеку нужен верный текст.
  const [dayUsed, weekUsed] = await Promise.all([
    quotaUsed(db, { ...input, kind: "add_word" }),
    quotaUsed(db, { ...input, kind: "add_word_week" }),
  ]);
  if (weekUsed >= week.limit) return { allowed: false, used: weekUsed, limit: week.limit, refusal: week.refusal };
  return { allowed: false, used: dayUsed, limit: day.limit, refusal: day.refusal };
}

/**
 * Вернуть место в лимите слов, если слово так и не сохранилось.
 *
 * Нужен потому, что место занимается **до** записи: если `saveWord` отказал (дубль, слишком длинное
 * слово, комната исчезла), списанное место было бы потеряно зря. Счётчик уменьшается, но не ниже нуля —
 * `max(0, …)`, чтобы повторный возврат не сделал его отрицательным.
 *
 * Неудача возврата не бросает исключение: вызывающий уже сообщает человеку об отказе сохранения, и
 * вторая ошибка в логе была бы шумом. Худшее последствие сбоя — потерянное место в лимите, а не
 * превышение.
 */
export async function refundWordQuota(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<void> {
  const periods = {
    add_word: periodKey(wordQuota("add_word").period, input.timeZone, input.now),
    add_word_week: periodKey(wordQuota("add_word_week").period, input.timeZone, input.now),
  };
  try {
    await db
      .update(usageCounters)
      .set({ count: sql`max(0, ${usageCounters.count} - 1)`, updatedAt: input.now })
      .where(and(
        eq(usageCounters.userId, input.userId),
        eq(usageCounters.scope, ""),
        sql`((${usageCounters.period} = ${periods.add_word} AND ${usageCounters.kind} = 'add_word')
          OR (${usageCounters.period} = ${periods.add_word_week} AND ${usageCounters.kind} = 'add_word_week'))`,
      ));
  } catch (err) {
    console.error("Refund word quota failed", input.userId, err);
  }
}

/**
 * Завести обе строки счётчиков со значением 0, если их ещё нет.
 *
 * Это подготовка, а не расход: `ON CONFLICT DO NOTHING` не трогает существующие строки, а отсутствие
 * места здесь ничего не решает — решает гейт в `checkAndCountWord`. Нужна, чтобы тот мог обновлять
 * строки, а не вставлять их: `DO UPDATE … WHERE` не проверяет условие при вставке.
 */
async function ensureWordCounters(
  db: Db,
  input: { userId: number; now: Date; dayPeriod: string; weekPeriod: string },
): Promise<void> {
  // Заводим строку, только если места хватает по ОБОИМ счётчикам: иначе отказ оставил бы в базе
  // нулевую строку, то есть след отказа. `SELECT … WHERE` не даёт вставить лишнего.
  const counter = (period: string, kind: QuotaKind) => sql`coalesce((
    SELECT p.count FROM usage_counters p
    WHERE p.user_id = ${input.userId} AND p.period = ${period} AND p.kind = ${kind} AND p.scope = ''
  ), 0)`;
  const room = sql`${counter(input.dayPeriod, "add_word")} < ${wordQuota("add_word").limit}
    AND ${counter(input.weekPeriod, "add_word_week")} < ${wordQuota("add_word_week").limit}`;
  // `values(...).where(...)` drizzle не поддерживает, поэтому строки заводятся `INSERT … SELECT`: у него
  // условие есть, и при исчерпанном пределе он просто не вставит ничего.
  await db.insert(usageCounters).select(sql`
    SELECT ${input.userId} AS user_id, ${input.dayPeriod} AS period, 'add_word' AS kind, '' AS scope, 0 AS count, ${input.now.getTime()} AS updated_at
    WHERE ${room}
    UNION ALL
    SELECT ${input.userId}, ${input.weekPeriod}, 'add_word_week', '', 0, ${input.now.getTime()}
    WHERE ${room}
  `).onConflictDoNothing();
}

/**
 * Сколько чего сделано по каждому лимиту — для /status.
 *
 * Собирается из `QUOTAS`, а не из списка в обработчике: лимит, добавленный в таблицу, виден админу
 * сразу, а забыть дописать строку в вывод невозможно. Лимиты «на слово» пропускаем: у них нет одного
 * числа на человека, и «0 из 3» там означало бы неправду.
 */
export async function quotaSummary(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<Array<{ kind: QuotaKind; used: number; limit: number; period: QuotaPeriod }>> {
  const kinds = (Object.keys(QUOTAS) as QuotaKind[]).filter((kind) => QUOTAS[kind].per !== "word");
  const used = await Promise.all(kinds.map((kind) => quotaUsed(db, { ...input, kind })));
  return kinds.map((kind, i) => ({ kind, used: used[i], limit: QUOTAS[kind].limit, period: QUOTAS[kind].period }));
}

/** Что ограничиваем на весь бот. Список закрытый — как у QuotaKind. */
export type BudgetKind = "image";

export interface Budget {
  kind: BudgetKind;
  /** Сколько штук за сутки можно на всех. */
  limit: number;
  /** Что сказать человеку, когда общий потолок выбран. Без слова «лимит»: ему важен не наш счёт. */
  refusal: string;
}

/**
 * Общие предохранители. Личный лимит не спасает от «200 человек одновременно рисуют»: 200 × 10 картинок
 * — это $67 в день, что дороже всей текстовой работы бота за месяц.
 *
 * 200 картинок ≈ $6.7 в день при нынешней модели. Потолок выбран с запасом: он должен ловить аварию
 * (цикл, наплыв, ошибка в коде), а не мешать нормальной работе. Днём он сбрасывается сам.
 */
export const BUDGETS: Record<BudgetKind, Budget> = {
  image: {
    kind: "image",
    limit: 200,
    refusal: "Картинок на сегодня уже нарисовано много — новые будут завтра.",
  },
};

/** День общего счётчика — по UTC. Пояс одного человека не должен управлять расходом всего бота. */
export function spendDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Сколько всего израсходовано за сутки. Без записи — для /status. */
export async function budgetUsed(db: Db, kind: BudgetKind, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: dailySpend.count })
    .from(dailySpend)
    .where(and(eq(dailySpend.day, spendDay(now)), eq(dailySpend.kind, kind)));
  return row?.count ?? 0;
}

/**
 * Проверить общий потолок и записать расход — одной операцией, как `checkAndCount`.
 *
 * Условный инкремент здесь важнее, чем у личных квот: это **общий** потолок на весь бот и он про деньги.
 * Замер на трёхстах одновременных вызовах при потолке 200 давал «разрешено 300, счётчик 300» —
 * то есть лишние сто картинок сверх предохранителя. Теперь `UPDATE … WHERE count < limit`
 * в одной инструкции, и лишние вызовы не проходят.
 *
 * Отказ не увеличивает счётчик: смысла в этом нет, за отказом не стоит никакой работы, а растущий
 * счётчик мешал бы понять, сколько нарисовано на самом деле.
 */
export async function checkAndSpend(db: Db, kind: BudgetKind, now: Date): Promise<QuotaState> {
  const budget = BUDGETS[kind];
  const day = spendDay(now);
  const refusal = { allowed: false, limit: budget.limit, refusal: budget.refusal } as const;

  const [written] = await db
    .insert(dailySpend)
    .values({ day, kind, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [dailySpend.day, dailySpend.kind],
      set: { count: sql`${dailySpend.count} + 1`, updatedAt: now },
      setWhere: sql`${dailySpend.count} < ${budget.limit}`,
    })
    .returning({ count: dailySpend.count });

  if (!written) return { ...refusal, used: await budgetUsed(db, kind, now) };
  return { allowed: true, used: written.count, limit: budget.limit, refusal: budget.refusal };
}

/**
 * Потолки на комнаты: сколько их можно создать, в скольких состоять и сколько людей в одной комнате.
 *
 * Это **не** `QUOTAS`, и намеренно: там счётчик растёт во времени и сбрасывается периодом, а здесь
 * ограничено само наличие — «три созданных комнаты», а не «три создания в день». Иначе лимит обходился
 * бы ожиданием до полуночи, а мусор в базе остался бы навсегда. Поэтому вместо `usage_counters` считаем
 * существующие строки: удалил комнату — вернул себе место, и это честно.
 *
 * Комнаты не зовут модель (в отличие от картинок), поэтому лимит здесь не про деньги, а про то, чтобы
 * комнаты потом можно было отличить друг от друга и чтобы человек не набивал себе 500 чужих словарей.
 */
export interface RoomLimits {
  /** Сколько комнат человек может создать сам (личные словари не в счёт — они заводятся сами). */
  created: number;
  /** В скольких комнатах человек может состоять. */
  joined: number;
  /** Сколько людей помещается в одну комнату. */
  members: number;
}

export const ROOM_LIMITS: RoomLimits = {
  created: 3,
  joined: 20,
  members: 50,
};

/**
 * Почему не получилось. Тексты — часть продукта, поэтому лежат здесь же, рядом с числами.
 *
 * `created` — не константа, а функция от того, сколько комнат у человека **уже есть**: лимит ввели
 * позже, чем появились комнаты, и у старожила их может быть больше трёх. Сказать ему «ты уже создал 3»
 * при семи на руках — соврать в лицо и потерять доверие ко всем остальным числам.
 */
export const ROOM_REFUSALS = {
  created: (have: number): string =>
    have > ROOM_LIMITS.created
      ? `У тебя уже ${have} комнат — это больше, чем нужно. Новую завести не получится, пока не удалишь лишние в /room.`
      : `Ты уже создал ${ROOM_LIMITS.created} комнаты — этого хватает для друзей. Удали ненужную в /room или вступи в чужую по ссылке.`,
  joined: `Ты уже в ${ROOM_LIMITS.joined} комнатах — больше не нужно. Выйти из старой можно в /room.`,
  full: `В комнате уже ${ROOM_LIMITS.members} человек — больше не помещается.`,
} as const;
