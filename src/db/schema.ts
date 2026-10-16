import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull();

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: integer("telegram_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  username: text("username"),
  reminderTime: text("reminder_time").notNull().default("20:00"),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  currentRoomId: integer("current_room_id"),
  lastReminderDate: text("last_reminder_date"),
  canDm: integer("can_dm", { mode: "boolean" }).notNull().default(false),
  groupHintSent: integer("group_hint_sent", { mode: "boolean" }).notNull().default(false),
  // Режимы тренажёра (ступени лесенки), см. services/exercises.ts.
  modeEnRu: integer("mode_en_ru", { mode: "boolean" }).notNull().default(true),
  modeRuEn: integer("mode_ru_en", { mode: "boolean" }).notNull().default(true),
  modeCloze: integer("mode_cloze", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  telegramChatId: integer("telegram_chat_id").unique(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: integer("room_id").notNull().references(() => rooms.id),
    userId: integer("user_id").notNull().references(() => users.id),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cards_user_word_idx").on(t.userId, t.wordId)],
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
});

export const reviewLogs = sqliteTable("review_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  cardId: integer("card_id").notNull().references(() => cards.id),
  rating: text("rating").notNull(),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Word = typeof words.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type ReviewLog = typeof reviewLogs.$inferSelect;
export type ClozeSentence = typeof clozeSentences.$inferSelect;
