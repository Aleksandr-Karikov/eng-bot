import { integer, primaryKey, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull();

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  username: text("username"),
  reminderTime: text("reminder_time").notNull().default("20:00"),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  currentRoomId: integer("current_room_id"),
  /** Последняя текущая комната каждого языка, JSON {"en": id, "ko": id}: /lang возвращает туда, где человек был. */
  lastRooms: text("last_rooms").notNull().default("{}"),
  lastReminderDate: text("last_reminder_date"),
  canDm: integer("can_dm", { mode: "boolean" }).notNull().default(false),
  groupHintSent: integer("group_hint_sent", { mode: "boolean" }).notNull().default(false),
  // Режимы тренажёра (ступени лесенки), см. services/exercises.ts.
  modeEnRu: integer("mode_en_ru", { mode: "boolean" }).notNull().default(true),
  modeRuEn: integer("mode_ru_en", { mode: "boolean" }).notNull().default(true),
  modeCloze: integer("mode_cloze", { mode: "boolean" }).notNull().default(true),
  modeSentence: integer("mode_sentence", { mode: "boolean" }).notNull().default(true),
  modeListen: integer("mode_listen", { mode: "boolean" }).notNull().default(true),
  modeCollocation: integer("mode_collocation", { mode: "boolean" }).notNull().default(true),
  modeDrill: integer("mode_drill", { mode: "boolean" }).notNull().default(true),
  /** Скрытые части карточки в /learn через запятую, см. services/card-view.ts. */
  cardHidden: text("card_hidden").notNull().default(""),
  /** Уведомлять, когда снова накопились слова к повторению. */
  notifyDue: integer("notify_due", { mode: "boolean" }).notNull().default(true),
  /** Личный ключ расширения браузера (/extension): по нему бот понимает, чьё слово пришло. */
  captureKey: text("capture_key").unique(),
  /** Личный итог недели в личку по воскресеньям. */
  weeklyReport: integer("weekly_report", { mode: "boolean" }).notNull().default(true),
  /** Дата (воскресенье) последнего личного итога. */
  lastReportDate: text("last_report_date"),
  lastDueNoticeAt: integer("last_due_notice_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  telegramChatId: integer("telegram_chat_id").unique(),
  /** Локальная дата (по поясу дайджеста) последнего еженедельного дайджеста. */
  lastDigestDate: text("last_digest_date"),
  /** Локальная дата последнего «слова дня» в группе. */
  lastWordOfDayDate: text("last_word_of_day_date"),
  /** Цель комнаты на неделю (повторений); 0 — подбирается сама по прошлой неделе. */
  weeklyGoal: integer("weekly_goal").notNull().default(0),
  /** Начало недели (дата дайджеста), за которую уже поздравили с выполненной целью. */
  goalReachedWeek: text("goal_reached_week"),
  /** Какой язык учат в комнате (lang.ts): en — английский, ko — корейский. */
  language: text("language").notNull().default("en"),
  /**
   * Личный словарь «Мои слова» этого человека — по одному на язык: создаётся сам, друзей в него не зовут
   * (для них — общие комнаты). Отдельная колонка, а не personal_of: та уникальна на человека, и снять это в SQLite
   * можно только пересозданием таблицы.
   */
  personalOf: integer("personal_owner").references(() => users.id),
  /** Прежняя отметка личного словаря (один на человека) — заполняется для английского, чтобы старый код при откате видел его. */
  legacyPersonalOf: integer("personal_of").unique().references(() => users.id),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("rooms_personal_lang_idx").on(t.personalOf, t.language)]);

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: integer("room_id").notNull().references(() => rooms.id),
    userId: integer("user_id").notNull().references(() => users.id),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("room_members_user_idx").on(t.userId),primaryKey({ columns: [t.roomId, t.userId] })],
);

export const words = sqliteTable(
  "words",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id").notNull().references(() => rooms.id),
    addedBy: integer("added_by").notNull().references(() => users.id),
    term: text("term").notNull(),
    termNormalized: text("term_normalized").notNull(),
    translation: text("translation").notNull(),
    explanation: text("explanation").notNull().default(""),
    example: text("example").notNull().default(""),
    transcriptionUk: text("transcription_uk").notNull().default(""),
    transcriptionUs: text("transcription_us").notNull().default(""),
    /** Telegram file_id готовой озвучки — чтобы не синтезировать заново. */
    audioUkFileId: text("audio_uk_file_id"),
    audioUsFileId: text("audio_us_file_id"),
    /** Запоминалка от Claude для «трудного» слова (общая для комнаты), "" — ещё нет. */
    mnemonic: text("mnemonic").notNull().default(""),
    /** Полезность: 3 — очень полезное, 2 — полезное, 1 — необязательное (учим только на узнавание); null — не оценено. */
    usefulness: integer("usefulness"),
    /** Почему такая полезность — коротко, по-русски. */
    usefulnessNote: text("usefulness_note").notNull().default(""),
    /** JSON Collocations: частые сочетания и вопрос «какое слово подходит». "" — ещё не готовили. */
    collocations: text("collocations").notNull().default(""),
    /** Предложение, где слово встретилось (из текста, скриншота или сообщения, на которое ответили /add). "" — нет. */
    context: text("context").notNull().default(""),
    /** JSON Array<{ text, title }>: ещё реплики, где слово встретилось (из расширения, «📍 Ещё пример»), новые первыми. */
    moreContexts: text("more_contexts").notNull().default("[]"),
    /** JSON-разбор «трудного» слова (LeechHelp): почему путается, отличия от похожих, примеры. "" — ещё нет. */
    leechHelp: text("leech_help").notNull().default(""),
    /** Telegram file_id картинки-ассоциации (по запоминалке). */
    imageFileId: text("image_file_id"),
    /** Когда слово было «словом дня» — чтобы не повторять его месяц. */
    featuredAt: integer("featured_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("words_room_term_idx").on(t.roomId, t.termNormalized)],
);

// FSRS-состояние хранится целиком в `fsrs` (JSON); due/state/reps/stability продублированы для запросов.
export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    wordId: integer("word_id").notNull().references(() => words.id),
    due: integer("due", { mode: "timestamp_ms" }).notNull(),
    state: integer("state").notNull(),
    reps: integer("reps").notNull(),
    stability: real("stability").notNull(),
    fsrs: text("fsrs").notNull(),
    /** Когда человек решил про новое слово друга: «учу», «знаю» (в «знаешь?» или колодой в приложении); null — ещё не решал. */
    triagedAt: integer("triaged_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("cards_word_idx").on(t.wordId),uniqueIndex("cards_user_word_idx").on(t.userId, t.wordId)],
);

/** Предложения с пропуском для ступени «вставь по смыслу»; общие для всех участников комнаты. */
export const clozeSentences = sqliteTable("cloze_sentences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wordId: integer("word_id").notNull().references(() => words.id),
  /** Предложение с пропуском "___". */
  sentence: text("sentence").notNull(),
  /** Форма слова, которая стоит в пропуске. */
  answer: text("answer").notNull(),
  translation: text("translation").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("cloze_word_idx").on(t.wordId),
]);

/** Ошибки из /check — записываются автору проверенного текста; из них строится профиль слабых мест. */
export const mistakes = sqliteTable("mistakes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  category: text("category").notNull(),
  wrong: text("wrong").notNull(),
  right: text("right").notNull(),
  createdAt: createdAt(),
  /** Тема отработана в «работе над ошибками» (верные ответы подряд) — больше не предлагается. */
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("mistakes_user_idx").on(t.userId),
]);

/** Ответы на вопросы «работы над ошибками» — по ним тема считается отработанной. */
export const drillAnswers = sqliteTable("drill_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  category: text("category").notNull(),
  correct: integer("correct", { mode: "boolean" }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("drill_answers_user_category_idx").on(t.userId, t.category),
]);

/** Очко дуэли: кто первым правильно ответил в раунде. Одна строка на выигранный раунд. */
export const duelPoints = sqliteTable("duel_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const reviewLogs = sqliteTable("review_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  cardId: integer("card_id").notNull().references(() => cards.id),
  rating: text("rating").notNull(),
  /** На какой ступени был ответ: en_ru, ru_en, cloze или know («Знаю» из уведомления). Для анализа; null у старых записей. */
  stage: text("stage"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
  /** JSON карточки до ответа ({ due, state, reps, stability, fsrs }) — чтобы ответ можно было отменить; null у старых записей. */
  before: text("before"),
}, (t) => [
  index("review_logs_user_time_idx").on(t.userId, t.reviewedAt),
  index("review_logs_card_idx").on(t.cardId),
]);

/** Слово комнаты, употреблённое в разговоре в группе (👏) — для недельного итога. */
export const wordUses = sqliteTable("word_uses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  userId: integer("user_id").notNull().references(() => users.id),
  wordId: integer("word_id").notNull().references(() => words.id),
  createdAt: createdAt(),
}, (t) => [
  index("word_uses_user_time_idx").on(t.userId, t.createdAt),
  index("word_uses_room_time_idx").on(t.roomId, t.createdAt),
]);

/** Упражнение, на которое бот ждёт ответ сообщением (ExerciseStore), — чтобы ожидание пережило перезапуск бота. */
export const pendingExercises = sqliteTable("pending_exercises", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  /** JSON PendingExercise. */
  data: text("data").notNull(),
  since: integer("since", { mode: "timestamp_ms" }).notNull(),
});

/** /bug: описание от пользователя и снимок того, что было вокруг (переписка, ошибки в логах). */
export const bugReports = sqliteTable("bug_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  chatId: integer("chat_id").notNull(),
  description: text("description").notNull(),
  /** JSON: { replied?, transcript[], logs[] }. */
  context: text("context").notNull(),
  /** open | fixed | wontfix */
  status: text("status").notNull().default("open"),
  /** Что сделано (или почему не чиним) — это же уходит автору при закрытии. */
  resolution: text("resolution"),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

/** Истории из слов комнаты (/story и еженедельно в группу): текст, вопросы на понимание и озвучка. */
export const stories = sqliteTable("stories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomId: integer("room_id").notNull().references(() => rooms.id),
  title: text("title").notNull(),
  /** Текст с **словами комнаты**. */
  body: text("body").notNull(),
  /** JSON: Array<{ term, translation }> — слова, вошедшие в историю. */
  glossary: text("glossary").notNull(),
  /** JSON: StoryQuestion[]. */
  questions: text("questions").notNull(),
  audioFileId: text("audio_file_id"),
  createdAt: createdAt(),
}, (t) => [
  index("stories_room_idx").on(t.roomId),
]);

/** 📦 Готовые наборы слов: по уровням (A1–C1) и по темам. Слова уже с переводом — разбор идёт без ожидания модели. */
export const wordSets = sqliteTable("word_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  /** level — уровень A1…C1; topic — тема. */
  kind: text("kind").notNull(),
  /** Язык слов набора (lang.ts). */
  language: text("language").notNull().default("en"),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

export const setItems = sqliteTable("set_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: integer("set_id").notNull().references(() => wordSets.id),
  term: text("term").notNull(),
  translation: text("translation").notNull(),
  explanation: text("explanation").notNull().default(""),
  example: text("example").notNull().default(""),
  transcriptionUk: text("transcription_uk").notNull().default(""),
  transcriptionUs: text("transcription_us").notNull().default(""),
  usefulness: integer("usefulness"),
  usefulnessNote: text("usefulness_note").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [
  index("set_items_set_idx").on(t.setId),
]);

/** Решение человека по слову набора: learn — учу (wordId — куда добавлено), know — знаю, drop — не для меня. */
export const setDecisions = sqliteTable("set_decisions", {
  userId: integer("user_id").notNull().references(() => users.id),
  itemId: integer("item_id").notNull().references(() => setItems.id),
  decision: text("decision").notNull(),
  wordId: integer("word_id"),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.itemId] }),
]);

/**
 * Счётчики использования: сколько раз человек за период сделал тяжёлую операцию.
 *
 * Одна таблица на все лимиты (см. docs/limits-and-pricing.md). Ключ — (userId, period, kind), где period —
 * строка вида «2026-10-27» для дневных квот и «2026-W43» для недельных: так одна таблица закрывает и день,
 * и неделю, и месяц, а поиск идёт по точному ключу, без LIKE (его в проекте нет).
 *
 * Почему не считаем по существующим таблицам (review_logs, words): не всё, что нужно ограничивать,
 * оставляет след. Отказ по лимиту обязан считаться тоже, иначе лимит обходится повтором запроса.
 */
export const usageCounters = sqliteTable("usage_counters", {
  userId: integer("user_id").notNull().references(() => users.id),
  /** День «2026-10-27» (по часовому поясу человека) или неделя «2026-W43». */
  period: text("period").notNull(),
  /** Что считаем: "inline_translate", "image", "check"… Список — QUOTAS в src/services/limits.ts. */
  kind: text("kind").notNull(),
  /**
   * К чему относится счётчик, если лимит не общий на человека, а на объект: «word:123».
   * Пустая строка — лимит на человека целиком. Нужно для «3 перерисовки на слово»: без этого
   * три попытки тратились бы на все слова сразу.
   */
  scope: text("scope").notNull().default(""),
  count: integer("count").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.period, t.kind, t.scope] }),
]);

/**
 * Расход на весь бот за день — отдельно от `usage_counters`, потому что здесь счёт не на человека.
 *
 * `usage_counters` ключуется пользователем, и подставить туда «общего» пользователя значило бы завести
 * фальшивую строку в `users` и сломать внешний ключ. Общий предохранитель нужен именно на всех:
 * 200 человек × 10 картинок — это $67 в день, и личный лимит от такого не спасает.
 *
 * Считаем **штуки, а не деньги**: цену знает только тот, кто выбрал модель, и прайс в коде устареет
 * молча, а число нарисованных картинок — нет.
 */
export const dailySpend = sqliteTable("daily_spend", {
  /** День «2026-10-27» по UTC: общий счётчик не должен зависеть от пояса одного человека. */
  day: text("day").notNull(),
  /** Что считаем: "image". Список — BUDGETS в src/services/limits.ts. */
  kind: text("kind").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.kind] }),
]);

export type WordSet = typeof wordSets.$inferSelect;
export type SetItem = typeof setItems.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type DailySpend = typeof dailySpend.$inferSelect;

export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Word = typeof words.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type ReviewLog = typeof reviewLogs.$inferSelect;
export type ClozeSentence = typeof clozeSentences.$inferSelect;
export type Mistake = typeof mistakes.$inferSelect;
export type Story = typeof stories.$inferSelect;
