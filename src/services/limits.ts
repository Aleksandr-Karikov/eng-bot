import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { dailySpend, usageCounters } from "../db/schema";
import { localParts } from "../time";

/**
 * Лимиты на тяжёлые операции: сколько раз человек может сделать что-то за период.
 *
 * Зачем: на старте доступ полный, но отдельный человек не должен выесть ключ. Дороже всего картинки
 * и вызовы модели, поэтому ограничиваем их точечно, а не «всё подряд» (см. docs/limits-and-pricing.md).
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
  | "image"
  | "image_redraw"
  | "add_word"
  | "add_word_week"
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
 * Квоты на время запуска. Тарифов пока нет — у всех одинаково (docs/limits-and-pricing.md).
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
 * Проверка и запись — одна операция намеренно: между «проверил» и «записал» не должно быть `await`,
 * иначе два одновременных запроса пройдут лимит вдвоём. Инкремент идёт одним UPDATE (`count + 1`),
 * поэтому гонка не теряет счётчик; в SQLite запись сериализуется базой.
 */
export async function checkAndCount(
  db: Db,
  input: { userId: number; kind: QuotaKind; timeZone: string; now: Date; wordId?: number },
): Promise<QuotaState> {
  const quota = QUOTAS[input.kind];
  const period = periodKey(quota.period, input.timeZone, input.now);
  const scope = scopeOf(quota, input.wordId);
  const key = { userId: input.userId, period, kind: input.kind, scope };
  const used = await quotaUsed(db, input);

  if (used >= quota.limit) {
    return { allowed: false, used, limit: quota.limit, refusal: quota.refusal };
  }

  // ON CONFLICT … DO UPDATE SET count = count + 1 — переносимо между SQLite и Postgres.
  await db
    .insert(usageCounters)
    .values({ ...key, count: 1, updatedAt: input.now })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.period, usageCounters.kind, usageCounters.scope],
      set: { count: sql`${usageCounters.count} + 1`, updatedAt: input.now },
    });

  return { allowed: true, used: used + 1, limit: quota.limit, refusal: quota.refusal };
}

/**
 * Подписи видов для человека. Хранятся здесь, рядом с лимитами: `/status` печатает строку на каждый
 * вид из `QUOTAS`, и без подписи админ увидел бы `inline_translate` вместо «Перевод в инлайне».
 */
const QUOTA_NAMES: Record<QuotaKind, string> = {
  inline_translate: "Перевод в инлайне",
  image: "Картинки к словам",
  image_redraw: "Перерисовки",
  add_word: "Новые слова",
  add_word_week: "Новые слова за неделю",
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
 * Сколько новых слов человек может добавить прямо сейчас — по дневному и недельному лимитам вместе.
 *
 * Два счётчика, а решение одно: показать остаток нужно там, где меньше запас, иначе человек увидит
 * «можно ещё 40», упрётся в недельный лимит на третьем слове и решит, что бот врёт.
 */
export async function wordsLeft(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<{ left: number; kind: QuotaKind; used: number; limit: number }> {
  const [dayUsed, weekUsed] = await Promise.all([
    quotaUsed(db, { ...input, kind: "add_word" }),
    quotaUsed(db, { ...input, kind: "add_word_week" }),
  ]);
  const day = { left: QUOTAS.add_word.limit - dayUsed, kind: "add_word" as const, used: dayUsed, limit: QUOTAS.add_word.limit };
  const week = { left: QUOTAS.add_word_week.limit - weekUsed, kind: "add_word_week" as const, used: weekUsed, limit: QUOTAS.add_word_week.limit };
  return week.left < day.left ? week : day;
}

/**
 * Проверить дневной и недельный лимиты на слова и, если оба позволяют, записать по попытке в каждый.
 *
 * Отказ **ничего** не пишет: если упёрся недельный, дневной счётчик тоже не растёт — иначе человек
 * сжигал бы дневной запас на отказах и после понедельника начинал бы день с нуля доступных слов.
 */
export async function checkAndCountWord(
  db: Db,
  input: { userId: number; timeZone: string; now: Date },
): Promise<QuotaState> {
  const [day, week] = await Promise.all([
    checkAndCount(db, { ...input, kind: "add_word" }),
    checkAndCount(db, { ...input, kind: "add_word_week" }),
  ]);
  if (!day.allowed) return day;
  if (!week.allowed) return week;
  return day;
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
 * Отказ не увеличивает счётчик: смысла в этом нет, за отказом не стоит никакой работы, а растущий
 * счётчик мешал бы понять, сколько нарисовано на самом деле.
 */
export async function checkAndSpend(db: Db, kind: BudgetKind, now: Date): Promise<QuotaState> {
  const budget = BUDGETS[kind];
  const day = spendDay(now);
  const used = await budgetUsed(db, kind, now);

  if (used >= budget.limit) {
    return { allowed: false, used, limit: budget.limit, refusal: budget.refusal };
  }

  await db
    .insert(dailySpend)
    .values({ day, kind, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [dailySpend.day, dailySpend.kind],
      set: { count: sql`${dailySpend.count} + 1`, updatedAt: now },
    });

  return { allowed: true, used: used + 1, limit: budget.limit, refusal: budget.refusal };
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

/** Почему не получилось. Тексты — часть продукта, поэтому лежат здесь же, рядом с числами. */
export const ROOM_REFUSALS = {
  created: `Ты уже создал ${ROOM_LIMITS.created} комнаты — этого хватает для друзей. Удали ненужную в /room или вступи в чужую по ссылке.`,
  joined: `Ты уже в ${ROOM_LIMITS.joined} комнатах — больше не нужно. Выйти из старой можно в /room.`,
  full: `В комнате уже ${ROOM_LIMITS.members} человек — больше не помещается.`,
} as const;
