import { integer, primaryKey, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import type { CombatTarget } from "../combat-mobs";

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull();

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  username: text("username"),
  reminderTime: text("reminder_time").notNull().default("20:00"),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  currentRoomId: integer("current_room_id"),
  /** Последняя текущая комната, JSON {"en": id}. Поле оставлено ради совместимости со старыми строками. */
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
  /**
   * 🐉 Босс недели: цель комнаты, показанная как бой (services/boss.ts). Выключено — везде остаются
   * те же числа, только без боя. Личное, а не комнатное: в общей комнате вкусы бывают разные.
   * По умолчанию включено — иначе режим никто не увидит, а выключить можно одной кнопкой.
   */
  modeBoss: integer("mode_boss", { mode: "boolean" }).notNull().default(true),
  bankDamage: integer("bank_damage", { mode: "boolean" }).notNull().default(false),
  /** 🐉 Уровень усиления: каждый даёт +10% к урону. Куплен за монеты, остаётся навсегда. */
  upgradeDamage: integer("upgrade_damage").notNull().default(0),
  upgradeListen: integer("upgrade_listen").notNull().default(0),
  upgradeWriting: integer("upgrade_writing").notNull().default(0),
  /** Сколько монет потрачено на этой неделе и на какой — по этим полям считается непотраченный остаток недели. */
  coinsSpent: integer("coins_spent").notNull().default(0),
  coinsPeriod: text("coins_period"),
  /**
   * 🪙 Копилка: монеты, перенесённые с прошлых недель.
   *
   * Раньше монеты сгорали в воскресенье, и прокачка упиралась: цена уровня растёт вдвое, а недельный
   * доход — нет, поэтому уровень застывал на втором навсегда. Без переноса «доходить дальше» в ладдере
   * боссов невозможно в принципе, а с ним каждая неделя становится вкладом в следующую.
   *
   * Хранится в десятых монеты, как и урон: монеты — это нанесённый урон, а он дробный.
   */
  coinsBankDeci: integer("coins_bank_deci").notNull().default(0),
  runesBought: integer("runes_bought").notNull().default(0),
  /** Скрытые части карточки в /learn через запятую, см. services/card-view.ts. */
  cardHidden: text("card_hidden").notNull().default(""),
  /**
   * Озвучка карточек в Mini App: каким произношением играть сразу при показе карточки.
   * "uk" / "us", см. services/voice.ts. Колонка и есть «включено/выключено»: пусто — не играть.
   * По умолчанию включена (DEFAULT_VOICE_ACCENT) — таково же и «выключено» у тех, кто её убрал.
   */
  voiceAccent: text("voice_accent").notNull().default("uk"),
  /** Уведомлять, когда снова накопились слова к повторению. */
  notifyDue: integer("notify_due", { mode: "boolean" }).notNull().default(true),
  /** Личный ключ расширения браузера (/extension): по нему бот понимает, чьё слово пришло. */
  captureKey: text("capture_key").unique(),
  /** Личный дневной лимит кнопки «Объясни»; null — обычный лимит. */
  explainLimit: integer("explain_limit"),
  /**
   * Куда идут слова из 📦 наборов, когда человек нажимает «учу». null — не спрашивали: слова идут
   * в личный словарь «Мои слова» (прежнее поведение). Иначе — id комнаты, выбранной человеком.
   *
   * Зачем настройка: раньше набор всегда шёл в личный словарь, и человек, уча слова в общей комнате,
   * не видел их в боссе этой комнаты — урон начислялся цели личной комнаты, где он один.
   */
  setTargetRoomId: integer("set_target_room_id"),
  /** Личный итог недели в личку по воскресеньям. */
  weeklyReport: integer("weekly_report", { mode: "boolean" }).notNull().default(true),
  /** Дата (воскресенье) последнего личного итога. */
  lastReportDate: text("last_report_date"),
  lastDueNoticeAt: integer("last_due_notice_at", { mode: "timestamp_ms" }),
  /**
   * Пояс пришёл из телефона (Mini App знает настоящий пояс), а не угадан при регистрации.
   *
   * Telegram пояса не отдаёт, поэтому при регистрации ставится пояс по умолчанию («догадка»). Настоящий
   * известен только приложению: оно присылает его при запуске, и тогда флаг закрывает догадку. Если человек
   * переехал, телефон пришлёт новый пояс — он применится, потому что источник по-прежнему настоящий.
   */
  timezoneFromDevice: integer("timezone_from_device", { mode: "boolean" }).notNull().default(false),
  /**
   * Откуда человек пришёл (`?start=<payload>`): "direct", "join_<code>", "set_<slug>" или payload как есть.
   * Заполняется один раз и больше не перезаписывается (см. `setSourceOnce`) — иначе второй переход
   * по чужой ссылке переписал бы историю и все выглядели бы пришедшими из последнего канала.
   */
  source: text("source"),
  /** Когда источник записан. null — человек был в боте до появления колонки: источник задним числом не выдумываем. */
  sourceAt: integer("source_at", { mode: "timestamp_ms" }),
  /**
   * Сколько НОВЫХ слов показывать за день (E30). 0 — без ограничения.
   *
   * Раньше потолка не было: слово друга появлялось в очереди в ту же секунду, а повторения стоят
   * впереди новых — при долге в сотню новых человек либо не доходил до них никогда, либо получал
   * всю пачку разом и не успевал. Порция считается по факту знакомства (первый ответ по карточке
   * за локальные сутки), поэтому пропущенный день не накапливается. Повторения не режутся.
   */
  newPerDay: integer("new_per_day").notNull().default(15),
  /** Сколько слов пользователь может учить одновременно, см. services/review.ts. */
  activeLearningLimit: integer("active_learning_limit").notNull().default(15),
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
  /** Цель комнаты на неделю в HP: HP босса и цель — одно число. 0 — общая цель `DEFAULT_GOAL_HP` (100). */
  weeklyGoal: integer("weekly_goal").notNull().default(0),
  /** Начало недели (дата дайджеста), за которую уже поздравили с выполненной целью. */
  goalReachedWeek: text("goal_reached_week"),
  /**
   * Неделя, за которую трофеи этой комнаты уже посчитаны.
   *
   * Нужна, чтобы недельный расчёт не повторялся на каждом тике напоминаний (раз в минуту): он читает
   * всю таблицу `trophies` и считает `weekFacts` по каждой комнате. Тот же приём, что у `goalReachedWeek`,
   * но со своей отметкой: поздравление с целью и трофеи — разные сообщения и могут разойтись по времени.
   */
  trophiesWeek: text("trophies_week"),
  /**
   * Часовой пояс комнаты — по нему считаются границы недели (босс, цель, монеты, трофеи, дайджест) и слово дня.
   *
   * Хранится в комнате, а не читается у создателя каждый раз: человек может сменить пояс, выйти из комнаты
   * или удалить аккаунт, а неделя должна остаться там же, где была. Заполняется поясом автора при создании.
   * Пусто (старые комнаты) — пояс по умолчанию, чтобы миграция не гадала.
   */
  timezone: text("timezone").notNull().default("Asia/Novosibirsk"),
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
}, (t) => [uniqueIndex("rooms_personal_idx").on(t.personalOf)]);

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

export const meetingPolls = sqliteTable("meeting_polls", {
  chatId: integer("chat_id").primaryKey(),
  time: text("time"),
  timezone: text("timezone").notNull(),
  options: text("options", { mode: "json" }).$type<string[]>().notNull(),
  lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
});

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
    /** Перевод примера на русский — готовится моделью по тапу в карточке приложения, чтобы пример не терял смысл. "" — ещё не переводили. */
    exampleTranslation: text("example_translation").notNull().default(""),
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
    /** Часть речи по-русски («существительное», «глагол»); "" — не определена. */
    partOfSpeech: text("part_of_speech").notNull().default(""),
    /** Уровень CEFR (A1…C2); "" — не определён. */
    cefr: text("cefr").notNull().default(""),
    /** JSON Array<{ form, label }>: значимые формы слова (forms → plural). "[]" — ещё не готовили. */
    forms: text("forms").notNull().default("[]"),
    /** JSON Array<{ term, translation }>: синонимы. "[]" — ещё не готовили. */
    synonyms: text("synonyms").notNull().default("[]"),
    /** JSON Array<{ term, translation }>: антонимы. "[]" — ещё не готовили. */
    antonyms: text("antonyms").notNull().default("[]"),
    /** Когда грамматику спрашивали у модели: чтобы не спрашивать снова, если она ответила «ничего нет». */
    grammarAskedAt: integer("grammar_asked_at", { mode: "timestamp_ms" }),
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
    /** Ручной порядок в подборке. Выбранные идут первыми, отложенные после остальных начатых. */
    learningPriority: integer("learning_priority").notNull().default(0),
    /** Предел при внеплановом возврате в обучение. null — обычное место. */
    relearningAtLimit: integer("relearning_at_limit"),
    createdAt: createdAt(),
  },
  (t) => [
    index("cards_word_idx").on(t.wordId),uniqueIndex("cards_user_word_idx").on(t.userId, t.wordId),
    // Составной (user_id, due): закрывает выборку очереди и `nextReviewAt` без временной сортировки.
    // С `(user_id, wordId)` запрос `WHERE user_id = ? ORDER BY due LIMIT 1` сортировал ВСЕ карточки
    // человека, чтобы взять одну (E33).
    index("cards_user_due_idx").on(t.userId, t.due)],
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

/**
 * 🏆 Трофей: постоянная запись о достижении. Хранится отдельно от review_logs, потому что deleteRoom
 * стирает историю комнаты — а коллекцию терять нельзя.
 *
 * Неделя записана строкой "2026-10-18" (дата воскресенья), `count` считает повторы трофея:
 * «Добил» ×3 — это три добитых босса.
 */
export const trophies = sqliteTable("trophies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  /** Ключ трофея из TROPHIES (services/trophies.ts). */
  kind: text("kind").notNull(),
  /** Неделя, за которую получен: "2026-10-18". */
  week: text("week").notNull(),
  /** Комната и её название на тот момент — комната может исчезнуть, а трофей останется. */
  roomId: integer("room_id"),
  roomName: text("room_name").notNull().default(""),
  /** Сколько HP снято этим трофеем (для «Добил ×3» и подписи). */
  value: integer("value").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  index("trophies_user_idx").on(t.userId),
  // Один и тот же трофей за одну и ту же неделю выдаём один раз — повторный тик напоминаний не должен дублировать.
  uniqueIndex("trophies_user_kind_week_idx").on(t.userId, t.kind, t.week),
]);

export const reviewLogs = sqliteTable("review_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  cardId: integer("card_id").notNull().references(() => cards.id),
  rating: text("rating").notNull(),
  /** Зафиксированный урон в десятых HP; null — старый ответ без усиления. */
  damageDeci: integer("damage_deci"),
  banked: integer("banked", { mode: "boolean" }).notNull().default(false),
  /** На какой ступени был ответ: en_ru, ru_en, cloze или know («Знаю» из уведомления). Для анализа; null у старых записей. */
  stage: text("stage"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
  /** JSON карточки до ответа ({ due, state, reps, stability, fsrs }) — чтобы ответ можно было отменить; null у старых записей. */
  before: text("before"),
}, (t) => [
  index("review_logs_user_time_idx").on(t.userId, t.reviewedAt),
  index("review_logs_card_idx").on(t.cardId),
]);

export const combatSpends = sqliteTable("combat_spends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  roomId: integer("room_id"),
  target: text("target").$type<CombatTarget>().notNull(),
  mobWeek: text("mob_week"),
  requestId: text("request_id").notNull(),
  damageDeci: integer("damage_deci").notNull(),
  bossDamageDeci: integer("boss_damage_deci"),
  coreWeek: text("core_week"),
  runeSerial: integer("rune_serial"),
  at: integer("at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("combat_spends_mob_week_idx").on(t.userId, t.target, t.mobWeek),
  uniqueIndex("combat_spends_request_idx").on(t.userId, t.requestId),
  uniqueIndex("combat_spends_core_idx").on(t.userId, t.roomId, t.coreWeek),
  uniqueIndex("combat_spends_rune_idx").on(t.userId, t.runeSerial),
  index("combat_spends_room_at_idx").on(t.roomId, t.at),
]);

/** Начисления сохраняются при удалении карточек и слов. */
export const combatArchive = sqliteTable("combat_archive", {
  reviewId: integer("review_id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  damageDeci: integer("damage_deci").notNull(),
}, (t) => [index("combat_archive_user_idx").on(t.userId)]);

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

/** Последний обычный провал, по которому пользователь уже запустил штурм слова. */
export const stormStarts = sqliteTable("storm_starts", {
  cardId: integer("card_id").primaryKey().references(() => cards.id, { onDelete: "cascade" }),
  triggerLogId: integer("trigger_log_id").notNull(),
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
 * 📘 Темы грамматики — статический контент, как наборы слов.
 *
 * Устроено намеренно без модели: темы и упражнения собираются заранее скриптом (`scripts/build-grammar.ts`)
 * и лежат в базе. Проверка ответа — сравнение с сохранённым правильным вариантом, а не суждение LLM:
 * генерация упражнений моделью нестабильна, и человек не должен зависеть от того, ответила она или нет.
 * Модель зовётся только на кнопку «почему так» — там её сбой ничего не блокирует.
 */
export const grammarTopics = sqliteTable("grammar_topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  /** Уровень CEFR: A1…C1. По нему темы идут от простого к сложному. */
  level: text("level").notNull().default("A1"),
  /**
   * Категория ошибки в терминах /check («времена», «артикли», «предлоги»): по ней промах в упражнении
   * попадает в ту же работу над ошибками, что и ошибки из переписки. Иначе слабые места копились бы
   * в двух несвязанных местах и в карточки подмешивались бы только половина.
   */
  category: text("category").notNull().default("другое"),
  /** Правило своими словами: что это и когда применять. Показывается перед упражнениями. */
  rule: text("rule").notNull().default(""),
  /** Разобранные примеры: «I have lived here since 2020 — since + точка отсчёта». По одному в строке. */
  examples: text("examples").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Упражнение темы. Три вида, и все проверяются без модели:
 *
 * - `choice` — выбрать вариант: `answer` один из `options` (через перевод строки);
 * - `gap` — вписать слово в пропуск: `answer` сравнивается без регистра и лишних пробелов;
 * - `order` — собрать предложение: `options` — слова, `answer` — правильный порядок.
 *
 * `prompt` — предложение с `___` там, где пропуск. `why` — короткое объяснение на случай ошибки.
 */
export const grammarExercises = sqliteTable("grammar_exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  topicId: integer("topic_id").notNull().references(() => grammarTopics.id),
  kind: text("kind").notNull(),
  prompt: text("prompt").notNull(),
  options: text("options").notNull().default(""),
  answer: text("answer").notNull(),
  /** Объяснение из контента: показывается сразу после ответа, модель для этого не нужна. */
  why: text("why").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [
  index("grammar_exercises_topic_idx").on(t.topicId),
]);

/** Прогресс по теме: сколько упражнений пройдено и сдан ли экзамен. По одной строке на человека и тему. */
export const grammarProgress = sqliteTable("grammar_progress", {
  userId: integer("user_id").notNull().references(() => users.id),
  topicId: integer("topic_id").notNull().references(() => grammarTopics.id),
  /** Верных ответов подряд в текущем проходе: сбрасывается на ошибке. */
  streak: integer("streak").notNull().default(0),
  /** Сколько упражнений темы уже отвечено верно (по одному разу каждое). */
  done: integer("done").notNull().default(0),
  /** Сдан ли экзамен темы: он открывается, когда пройдены все упражнения. */
  passed: integer("passed", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.topicId] }),
]);

/**
 * Счётчики использования: сколько раз человек за период сделал тяжёлую операцию.
 *
 * Одна таблица на все лимиты (см. docs/limits.md). Ключ — (userId, period, kind), где period —
 * строка вида «2026-10-27» для дневных квот и «2026-W43» для недельных: так одна таблица закрывает и день,
 * и неделю, и месяц, а поиск идёт по точному ключу, без LIKE (его в проекте нет).
 *
 * Почему не считаем по существующим таблицам (review_logs, words): не всё, что нужно ограничивать,
 * оставляет след — генерация запоминалки или перевод в инлайне никуда не пишутся. А вот отказ счётчик
 * не трогает (`checkAndCount` пишет только когда лимит позволяет): за отказом не стоит ни вызова модели,
 * ни денег, и растущий счётчик только мешал бы человеку после сброса периода.
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
export type GrammarTopic = typeof grammarTopics.$inferSelect;
export type GrammarExercise = typeof grammarExercises.$inferSelect;
export type GrammarProgress = typeof grammarProgress.$inferSelect;
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
