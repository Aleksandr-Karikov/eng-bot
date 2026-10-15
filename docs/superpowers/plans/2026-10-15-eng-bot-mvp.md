# eng-bot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-бот для совместного заучивания английских слов: общие комнаты, LLM-подсказки при добавлении, «знаешь?»-уведомления, повторение по FSRS, напоминания и статистика.

**Architecture:** Один Node.js-процесс (TypeScript, запуск через tsx), grammY в режиме long polling, SQLite через Drizzle ORM. Вся логика в `src/services/` — асинхронные функции, получающие `db` и `now` параметрами и тестируемые на SQLite in-memory. Telegram-слой (`src/bot/`) тонкий; LLM (Claude Agent SDK) и FSRS (ts-fsrs) спрятаны за маленькими модулями.

**Tech Stack:** Node ≥ 20.12, TypeScript 5, grammY 1, drizzle-orm + drizzle-kit, better-sqlite3, ts-fsrs, zod 3, @anthropic-ai/claude-agent-sdk, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-eng-bot-design.md`

## Global Constraints

- LLM вызывается только через `@anthropic-ai/claude-agent-sdk` (локальный Claude Code). Никакого `@anthropic-ai/sdk`, никакого `ANTHROPIC_API_KEY`.
- Языковая пара фиксированная: английский термин → русский перевод. Все тексты бота на русском.
- Сообщения бота отправляются с `parse_mode: "HTML"`; любой пользовательский/LLM-текст проходит через `esc()`.
- Значения по умолчанию: `reminder_time = "20:00"`, `timezone = "Europe/Moscow"`, таймаут LLM 30 000 мс, модель `haiku`.
- «Выучено» = `state === State.Review && stability >= 21`.
- Кнопки → FSRS: Забыл → again, С трудом → hard, Помню → good, Знаю / Уже знаю → easy.
- Лимитов на число новых слов нет.
- Сервисы не импортируют ничего из `grammy`; `src/bot/` не содержит SQL.
- Код запросов пишется через `await db.select()/insert()/update()` (без sqlite-специфичных `.get()/.all()/.run()`) и без `db.transaction`, чтобы переезд на Postgres был заменой драйвера.
- Импорты без расширений (`moduleResolution: "Bundler"`, запуск через tsx).

## Review Focus

1. **Повторное нажатие старых кнопок** (двойной тап по оценке, «Знаю» после того, как слово уже повторено) — должно отвечать «уже учтено» и не менять карточку дважды. Тесты: Task 8 (`answerCard` stale, `markKnown` stale).
2. **Пользователь заблокировал бота / не нажал Start** — рассылка не падает, `can_dm` становится `false`. Тест: Task 12.
3. **Регистр и пробелы в слове** («Bank », «bank») — считаются одним словом, дубль не создаётся. Тест: Task 7.
4. **Мак спал в момент напоминания / смена суток в часовом поясе пользователя** — напоминание приходит ровно раз в локальные сутки и «догоняет» после простоя. Тест: Task 10.
5. **Спецсимволы HTML в словах и ответах LLM** (`R&D`, `<3`) — сообщение не ломается. Тест: Task 13 (`esc`, `draftText`).

---

## File Structure

```
package.json, tsconfig.json, drizzle.config.ts, .gitignore, .env.example, README.md
drizzle/                         — сгенерированные SQL-миграции (коммитятся)
src/
  config.ts                      — loadConfig(env)
  time.ts                        — localParts, parseHHMM, previousDate
  db/schema.ts                   — таблицы и типы строк
  db/client.ts                   — createDb(path): Db (+ миграции)
  srs/srs.ts                     — newCard, review (обёртка ts-fsrs)
  services/users.ts              — upsertUser, getUser, updateUser
  services/cards.ts              — createCards
  services/rooms.ts              — createRoom, joinRoom, isMember, find*/list*, linkGroup
  services/words.ts              — normalizeTerm, parseAddInput, findWord, getWord, saveWord
  services/review.ts             — nextDue, countDue, getDueItemByCard, answerCard, markKnown, nextReviewAt
  services/stats.ts              — computeStreak, personalStats, roomLeaderboard
  services/reminders.ts          — collectReminders
  llm/enricher.ts                — WordEnricher, buildPrompt, parseEnrichment
  llm/claude-code.ts             — ClaudeCodeEnricher (Agent SDK)
  notifier.ts                    — Notifier (dm/group, обработка 403)
  bot/context.ts                 — BotContext, Deps
  bot/callbacks.ts               — encodeCb/decodeCb
  bot/texts.ts                   — esc, plural, все тексты сообщений
  bot/keyboards.ts               — inline-клавиатуры
  bot/drafts.ts                  — DraftStore
  bot/middleware.ts              — userMiddleware (upsert, can_dm, авто-вступление из группы)
  bot/handlers/rooms.ts          — /start, /room, /newroom, /link
  bot/handlers/add.ts            — /add, текст в личке, черновики
  bot/handlers/learn.ts          — /learn, показ/оценка, «знаешь?»
  bot/handlers/stats.ts          — /stats, /settings
  bot/setup.ts                   — setupBot, COMMANDS
  reminder-loop.ts               — startReminderLoop
  index.ts                       — точка входа
scripts/try-enrich.ts            — ручная проверка Claude Code
tests/                           — *.test.ts + helpers.ts
```

---

### Task 1: Каркас проекта и конфиг

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `interface Config { botToken: string; dbPath: string; enrichModel: string; enrichTimeoutMs: number }`, `loadConfig(env?: Record<string, string | undefined>): Config`

- [ ] **Step 1: Создать package.json и поставить зависимости**

```json
{
  "name": "eng-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.12" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  }
}
```

Run:
```bash
npm install grammy@^1 drizzle-orm@^0.44 better-sqlite3@^12 ts-fsrs@^5 zod@^3.25 @anthropic-ai/claude-agent-sdk
npm install -D typescript@^5 tsx@^4 vitest@^3 drizzle-kit@^0.31 @types/better-sqlite3 @types/node@^22
```
Если какой-то диапазон не ставится — взять последнюю версию пакета и записать это в отчёт. Из ts-fsrs используются только `createEmptyCard`, `fsrs`, `generatorParameters`, `Rating`, `State`, `Card`, `Grade` и метод `next`.

- [ ] **Step 2: tsconfig.json, .gitignore, .env.example**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts", "drizzle.config.ts"]
}
```

`.gitignore`:
```
node_modules/
data/
.env
```

`.env.example`:
```
# Токен от @BotFather
BOT_TOKEN=
# Путь к файлу SQLite
DB_PATH=data/eng-bot.sqlite
# Модель Claude Code для подсказок (алиас: haiku / sonnet)
ENRICH_MODEL=haiku
ENRICH_TIMEOUT_MS=30000
```

- [ ] **Step 3: Написать падающий тест**

`tests/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("throws when BOT_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow("BOT_TOKEN");
  });

  it("applies defaults", () => {
    expect(loadConfig({ BOT_TOKEN: "t" })).toEqual({
      botToken: "t",
      dbPath: "data/eng-bot.sqlite",
      enrichModel: "haiku",
      enrichTimeoutMs: 30_000,
    });
  });

  it("reads overrides", () => {
    const config = loadConfig({ BOT_TOKEN: "t", DB_PATH: "x.db", ENRICH_MODEL: "sonnet", ENRICH_TIMEOUT_MS: "5000" });
    expect(config).toMatchObject({ dbPath: "x.db", enrichModel: "sonnet", enrichTimeoutMs: 5000 });
  });
});
```

- [ ] **Step 4: Запустить — должен упасть**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 5: Реализация**

`src/config.ts`:
```ts
export interface Config {
  botToken: string;
  dbPath: string;
  enrichModel: string;
  enrichTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const botToken = env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN is not set (see .env.example)");
  return {
    botToken,
    dbPath: env.DB_PATH || "data/eng-bot.sqlite",
    enrichModel: env.ENRICH_MODEL || "haiku",
    enrichTimeoutMs: Number(env.ENRICH_TIMEOUT_MS || 30_000),
  };
}
```

- [ ] **Step 6: Тесты и typecheck**

Run: `npx vitest run tests/config.test.ts && npm run typecheck`
Expected: 3 passed, typecheck без ошибок.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/config.ts tests/config.test.ts
git commit -m "chore: scaffold project and config"
```

---

### Task 2: Схема БД, подключение, миграции

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `drizzle/*` (генерируется), `tests/helpers.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: таблицы `users, rooms, roomMembers, words, cards, reviewLogs`; типы `User, Room, Word, CardRow, ReviewLog`; `type Db`; `createDb(path: string): Db`; в `tests/helpers.ts`: `T0: Date`, `MIN`, `HOUR`, `DAY` (мс), `at(ms: number): Date`, `testDb(): Db`.

- [ ] **Step 1: Схема**

`src/db/schema.ts`:
```ts
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
```

- [ ] **Step 2: Конфиг drizzle-kit и генерация миграции**

`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

Run: `npm run db:generate`
Expected: в `drizzle/` появились `0000_*.sql` и `meta/`.

- [ ] **Step 3: Клиент**

`src/db/client.ts`:
```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function createDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
```

- [ ] **Step 4: Хелперы тестов**

`tests/helpers.ts`:
```ts
import { createDb, type Db } from "../src/db/client";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** 2026-10-15 12:00 по Москве. */
export const T0 = new Date("2026-10-15T09:00:00Z");
export const at = (ms: number) => new Date(T0.getTime() + ms);

export function testDb(): Db {
  return createDb(":memory:");
}
```

- [ ] **Step 5: Тест**

`tests/db.test.ts`:
```ts
import { expect, it } from "vitest";
import { users } from "../src/db/schema";
import { T0, testDb } from "./helpers";

it("applies migrations, sets defaults and enforces unique telegram id", async () => {
  const db = testDb();
  await db.insert(users).values({ telegramId: 1, firstName: "A", createdAt: T0 });
  await expect(db.insert(users).values({ telegramId: 1, firstName: "B", createdAt: T0 })).rejects.toThrow();
  const [row] = await db.select().from(users);
  expect(row).toMatchObject({ reminderTime: "20:00", timezone: "Europe/Moscow", canDm: false, createdAt: T0 });
});
```

- [ ] **Step 6: Запустить**

Run: `npx vitest run tests/db.test.ts && npm run typecheck`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/db drizzle drizzle.config.ts tests/helpers.ts tests/db.test.ts
git commit -m "feat: database schema and migrations"
```

---

### Task 3: SRS-обёртка над ts-fsrs

**Files:**
- Create: `src/srs/srs.ts`
- Test: `tests/srs.test.ts`

**Interfaces:**
- Produces: `type Answer = "again" | "hard" | "good" | "easy"`; `interface SrsSnapshot { due: Date; state: number; reps: number; stability: number; fsrs: string }` (поля совпадают с колонками `cards`); `newCard(now: Date): SrsSnapshot`; `review(fsrsJson: string, answer: Answer, now: Date): SrsSnapshot`.

- [ ] **Step 1: Падающий тест**

`tests/srs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { newCard, review } from "../src/srs/srs";
import { DAY, T0 } from "./helpers";

describe("srs", () => {
  it("new card is due immediately", () => {
    const c = newCard(T0);
    expect(c.due.getTime()).toBe(T0.getTime());
    expect(c.state).toBe(State.New);
    expect(c.reps).toBe(0);
  });

  it("easy on a new card pushes it days ahead", () => {
    const c = review(newCard(T0).fsrs, "easy", T0);
    expect(c.state).toBe(State.Review);
    expect(c.reps).toBe(1);
    expect(c.due.getTime() - T0.getTime()).toBeGreaterThanOrEqual(4 * DAY);
  });

  it("again on a new card brings it back within a day", () => {
    const c = review(newCard(T0).fsrs, "again", T0);
    expect(c.due.getTime() - T0.getTime()).toBeLessThan(DAY);
  });

  it("successful reviews grow the interval", () => {
    const first = review(newCard(T0).fsrs, "easy", T0);
    const firstInterval = first.due.getTime() - T0.getTime();
    const second = review(first.fsrs, "good", first.due);
    expect(second.due.getTime() - first.due.getTime()).toBeGreaterThan(firstInterval);
  });

  it("forgetting a review card shortens the interval", () => {
    const learned = review(newCard(T0).fsrs, "easy", T0);
    const lapsed = review(learned.fsrs, "again", learned.due);
    expect(lapsed.due.getTime() - learned.due.getTime()).toBeLessThan(DAY);
    expect(lapsed.state).toBe(State.Relearning);
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/srs.test.ts`
Expected: FAIL — `Cannot find module '../src/srs/srs'`

- [ ] **Step 3: Реализация**

`src/srs/srs.ts`:
```ts
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";

export type Answer = "again" | "hard" | "good" | "easy";

/** Поля совпадают с колонками таблицы cards — можно передавать прямо в insert/update. */
export interface SrsSnapshot {
  due: Date;
  state: number;
  reps: number;
  stability: number;
  fsrs: string;
}

const GRADES: Record<Answer, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

function snapshot(card: Card): SrsSnapshot {
  return { due: card.due, state: card.state, reps: card.reps, stability: card.stability, fsrs: JSON.stringify(card) };
}

function parse(json: string): Card {
  const raw = JSON.parse(json);
  return { ...raw, due: new Date(raw.due), last_review: raw.last_review ? new Date(raw.last_review) : undefined };
}

export function newCard(now: Date): SrsSnapshot {
  return snapshot(createEmptyCard(now));
}

export function review(fsrsJson: string, answer: Answer, now: Date): SrsSnapshot {
  return snapshot(scheduler.next(parse(fsrsJson), now, GRADES[answer]).card);
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/srs.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/srs tests/srs.test.ts
git commit -m "feat: FSRS wrapper"
```

---

### Task 4: Утилиты времени

**Files:**
- Create: `src/time.ts`
- Test: `tests/time.test.ts`

**Interfaces:**
- Produces: `localParts(timeZone: string, now: Date): { date: string; time: string }` (`YYYY-MM-DD`, `HH:MM`); `parseHHMM(input: string): string | null`; `previousDate(date: string): string`.

- [ ] **Step 1: Падающий тест**

`tests/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { localParts, parseHHMM, previousDate } from "../src/time";

describe("time", () => {
  it("returns local date and time in the given zone", () => {
    expect(localParts("Europe/Moscow", new Date("2026-10-15T21:30:00Z"))).toEqual({ date: "2026-10-16", time: "00:30" });
    expect(localParts("UTC", new Date("2026-10-15T09:05:00Z"))).toEqual({ date: "2026-10-15", time: "09:05" });
  });

  it("parses HH:MM", () => {
    expect(parseHHMM("9:05")).toBe("09:05");
    expect(parseHHMM(" 21:30 ")).toBe("21:30");
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
  });

  it("computes previous date across month boundary", () => {
    expect(previousDate("2026-03-01")).toBe("2026-02-28");
    expect(previousDate("2026-10-15")).toBe("2026-10-14");
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/time.ts`:
```ts
export function localParts(timeZone: string, now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function parseHHMM(input: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${m[2]}`;
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/time.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/time.ts tests/time.test.ts
git commit -m "feat: time helpers"
```

---

### Task 5: Сервис пользователей

**Files:**
- Create: `src/services/users.ts`
- Modify: `tests/helpers.ts` (добавить `makeUser`)
- Test: `tests/users.test.ts`

**Interfaces:**
- Consumes: `Db`, `users`, `User` (Task 2).
- Produces: `interface TgUser { id: number; first_name: string; username?: string }`; `type UserPatch = Partial<Pick<User, "canDm" | "reminderTime" | "currentRoomId" | "lastReminderDate" | "groupHintSent">>`; `upsertUser(db, tg: TgUser, now: Date): Promise<User>`; `getUser(db, id: number): Promise<User | undefined>`; `updateUser(db, id: number, patch: UserPatch): Promise<User>`; хелпер `makeUser(db, telegramId: number, firstName?: string): Promise<User>`.

- [ ] **Step 1: Добавить хелпер**

В конец `tests/helpers.ts`:
```ts
import type { User } from "../src/db/schema";
import { upsertUser } from "../src/services/users";

export function makeUser(db: Db, telegramId: number, firstName = `User${telegramId}`): Promise<User> {
  return upsertUser(db, { id: telegramId, first_name: firstName }, T0);
}
```
(импорты поднять наверх файла.)

- [ ] **Step 2: Падающий тест**

`tests/users.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getUser, updateUser, upsertUser } from "../src/services/users";
import { T0, testDb } from "./helpers";

describe("users", () => {
  it("creates a user once and refreshes the name", async () => {
    const db = testDb();
    const a = await upsertUser(db, { id: 42, first_name: "Саша" }, T0);
    const b = await upsertUser(db, { id: 42, first_name: "Александр", username: "sasha" }, T0);
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ firstName: "Александр", username: "sasha", telegramId: 42 });
  });

  it("patches fields", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    const updated = await updateUser(db, u.id, { canDm: true, reminderTime: "09:00" });
    expect(updated).toMatchObject({ canDm: true, reminderTime: "09:00" });
    expect(await getUser(db, u.id)).toMatchObject({ canDm: true });
    expect(await getUser(db, 999)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Запустить — FAIL**

Run: `npx vitest run tests/users.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Реализация**

`src/services/users.ts`:
```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type User } from "../db/schema";

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
}

export type UserPatch = Partial<
  Pick<User, "canDm" | "reminderTime" | "currentRoomId" | "lastReminderDate" | "groupHintSent">
>;

export async function upsertUser(db: Db, tg: TgUser, now: Date): Promise<User> {
  const username = tg.username ?? null;
  const [existing] = await db.select().from(users).where(eq(users.telegramId, tg.id));
  if (existing) {
    if (existing.firstName === tg.first_name && existing.username === username) return existing;
    const [updated] = await db
      .update(users)
      .set({ firstName: tg.first_name, username })
      .where(eq(users.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(users)
    .values({ telegramId: tg.id, firstName: tg.first_name, username, createdAt: now })
    .returning();
  return created;
}

export async function getUser(db: Db, id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function updateUser(db: Db, id: number, patch: UserPatch): Promise<User> {
  const [user] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return user;
}
```

- [ ] **Step 5: Запустить — PASS**

Run: `npx vitest run tests/users.test.ts && npm run typecheck`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/services/users.ts tests/users.test.ts tests/helpers.ts
git commit -m "feat: users service"
```

---

### Task 6: Комнаты и создание карточек

**Files:**
- Create: `src/services/cards.ts`, `src/services/rooms.ts`
- Test: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: `newCard` (Task 3), `getUser`, `updateUser` (Task 5).
- Produces:
  - `createCards(db, userIds: number[], wordIds: number[], now: Date): Promise<void>` — идемпотентно (конфликты игнорируются).
  - `createRoom(db, input: { name: string; createdBy: number; now: Date; telegramChatId?: number }): Promise<Room>` — создатель становится участником, комната — его текущей.
  - `joinRoom(db, input: { roomId: number; userId: number; now: Date; makeCurrent: boolean }): Promise<boolean>` — `true`, если вступил впервые; создаёт карточки на все слова комнаты; текущей делает при `makeCurrent` или если текущей нет.
  - `isMember(db, roomId, userId): Promise<boolean>`
  - `getRoom(db, id): Promise<Room | undefined>`, `findRoomByInvite(db, code): Promise<Room | undefined>`, `findRoomByChat(db, chatId): Promise<Room | undefined>`
  - `listUserRooms(db, userId): Promise<Room[]>`, `listMembers(db, roomId): Promise<User[]>`
  - `linkGroup(db, roomId, chatId): Promise<"linked" | "chat_taken" | "room_has_group">`

- [ ] **Step 1: Падающий тест**

`tests/rooms.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import {
  createRoom, findRoomByChat, findRoomByInvite, isMember, joinRoom, linkGroup, listMembers, listUserRooms,
} from "../src/services/rooms";
import { getUser } from "../src/services/users";
import { T0, makeUser, testDb } from "./helpers";

async function addRawWord(db: ReturnType<typeof testDb>, roomId: number, addedBy: number, term: string) {
  const [w] = await db
    .insert(words)
    .values({ roomId, addedBy, term, termNormalized: term, translation: "t", createdAt: T0 })
    .returning();
  return w;
}

describe("rooms", () => {
  it("creator becomes a member and the room becomes current", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "Друзья", createdBy: alice.id, now: T0 });
    expect(room.inviteCode.length).toBeGreaterThanOrEqual(8);
    expect(await isMember(db, room.id, alice.id)).toBe(true);
    expect((await getUser(db, alice.id))?.currentRoomId).toBe(room.id);
    expect(await findRoomByInvite(db, room.inviteCode)).toMatchObject({ id: room.id });
  });

  it("joining creates cards for existing words, only once", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await addRawWord(db, room.id, alice.id, "a");
    await addRawWord(db, room.id, alice.id, "b");

    expect(await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true })).toBe(true);
    expect(await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true })).toBe(false);
    expect(await db.select().from(cards).where(eq(cards.userId, bob.id))).toHaveLength(2);
    expect((await listMembers(db, room.id)).map((u) => u.id).sort()).toEqual([alice.id, bob.id]);
  });

  it("makeCurrent=false keeps an existing current room", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const first = await createRoom(db, { name: "1", createdBy: alice.id, now: T0 });
    const bob = await makeUser(db, 2);
    const second = await createRoom(db, { name: "2", createdBy: bob.id, now: T0 });
    await joinRoom(db, { roomId: second.id, userId: alice.id, now: T0, makeCurrent: false });
    expect((await getUser(db, alice.id))?.currentRoomId).toBe(first.id);
    expect((await listUserRooms(db, alice.id)).map((r) => r.id).sort()).toEqual([first.id, second.id]);
  });

  it("links a group once", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const r1 = await createRoom(db, { name: "1", createdBy: alice.id, now: T0 });
    const r2 = await createRoom(db, { name: "2", createdBy: alice.id, now: T0 });
    expect(await linkGroup(db, r1.id, -100)).toBe("linked");
    expect(await findRoomByChat(db, -100)).toMatchObject({ id: r1.id });
    expect(await linkGroup(db, r2.id, -100)).toBe("chat_taken");
    expect(await linkGroup(db, r1.id, -200)).toBe("room_has_group");
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/rooms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: cards.ts**

`src/services/cards.ts`:
```ts
import type { Db } from "../db/client";
import { cards } from "../db/schema";
import { newCard } from "../srs/srs";

const CHUNK = 200;

export async function createCards(db: Db, userIds: number[], wordIds: number[], now: Date): Promise<void> {
  const rows = userIds.flatMap((userId) => wordIds.map((wordId) => ({ userId, wordId, createdAt: now, ...newCard(now) })));
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(cards).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}
```

- [ ] **Step 4: rooms.ts**

`src/services/rooms.ts`:
```ts
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { roomMembers, rooms, users, words, type Room, type User } from "../db/schema";
import { createCards } from "./cards";
import { getUser, updateUser } from "./users";

export async function createRoom(
  db: Db,
  input: { name: string; createdBy: number; now: Date; telegramChatId?: number },
): Promise<Room> {
  const [room] = await db
    .insert(rooms)
    .values({
      name: input.name,
      inviteCode: randomBytes(6).toString("base64url"),
      telegramChatId: input.telegramChatId ?? null,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .returning();
  await joinRoom(db, { roomId: room.id, userId: input.createdBy, now: input.now, makeCurrent: true });
  return room;
}

export async function isMember(db: Db, roomId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select({ roomId: roomMembers.roomId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  return rows.length > 0;
}

export async function joinRoom(
  db: Db,
  input: { roomId: number; userId: number; now: Date; makeCurrent: boolean },
): Promise<boolean> {
  const alreadyMember = await isMember(db, input.roomId, input.userId);
  if (!alreadyMember) {
    await db.insert(roomMembers).values({ roomId: input.roomId, userId: input.userId, joinedAt: input.now });
    const roomWords = await db.select({ id: words.id }).from(words).where(eq(words.roomId, input.roomId));
    await createCards(db, [input.userId], roomWords.map((w) => w.id), input.now);
  }
  const user = await getUser(db, input.userId);
  if (input.makeCurrent || user?.currentRoomId == null) {
    await updateUser(db, input.userId, { currentRoomId: input.roomId });
  }
  return !alreadyMember;
}

export async function getRoom(db: Db, id: number): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
  return room;
}

export async function findRoomByInvite(db: Db, code: string): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.inviteCode, code));
  return room;
}

export async function findRoomByChat(db: Db, chatId: number): Promise<Room | undefined> {
  const [room] = await db.select().from(rooms).where(eq(rooms.telegramChatId, chatId));
  return room;
}

export async function listUserRooms(db: Db, userId: number): Promise<Room[]> {
  const rows = await db
    .select({ room: rooms })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(eq(roomMembers.userId, userId));
  return rows.map((r) => r.room);
}

export async function listMembers(db: Db, roomId: number): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(roomMembers)
    .innerJoin(users, eq(roomMembers.userId, users.id))
    .where(eq(roomMembers.roomId, roomId));
  return rows.map((r) => r.user);
}

export async function linkGroup(
  db: Db,
  roomId: number,
  chatId: number,
): Promise<"linked" | "chat_taken" | "room_has_group"> {
  if (await findRoomByChat(db, chatId)) return "chat_taken";
  const room = await getRoom(db, roomId);
  if (room?.telegramChatId != null) return "room_has_group";
  await db.update(rooms).set({ telegramChatId: chatId }).where(eq(rooms.id, roomId));
  return "linked";
}
```

- [ ] **Step 5: Запустить — PASS**

Run: `npx vitest run tests/rooms.test.ts && npm run typecheck`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/services/cards.ts src/services/rooms.ts tests/rooms.test.ts
git commit -m "feat: rooms service"
```

---

### Task 7: Слова

**Files:**
- Create: `src/services/words.ts`
- Test: `tests/words.test.ts`

**Interfaces:**
- Consumes: `createCards`, `listMembers` (Task 6).
- Produces:
  - `normalizeTerm(term: string): string`
  - `parseAddInput(text: string): { term: string; translation?: string } | null`
  - `interface WordDraft { term: string; translation: string; explanation: string; example: string }`
  - `findWord(db, roomId: number, term: string): Promise<Word | undefined>`
  - `getWord(db, id: number): Promise<Word | undefined>`
  - `saveWord(db, input: { roomId: number; addedBy: number; draft: WordDraft; now: Date }): Promise<{ status: "duplicate" } | { status: "saved"; word: Word; members: User[] }>`

- [ ] **Step 1: Падающий тест**

`tests/words.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cards } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { findWord, normalizeTerm, parseAddInput, saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

const draft = { term: "Bank", translation: "берег", explanation: "", example: "" };

describe("parseAddInput", () => {
  it("parses term with optional translation", () => {
    expect(parseAddInput("serendipity")).toEqual({ term: "serendipity" });
    expect(parseAddInput(" bank — берег реки ")).toEqual({ term: "bank", translation: "берег реки" });
    expect(parseAddInput("bank - берег")).toEqual({ term: "bank", translation: "берег" });
    expect(parseAddInput("well-known")).toEqual({ term: "well-known" });
    expect(parseAddInput("   ")).toBeNull();
    expect(parseAddInput(" — берег")).toBeNull();
  });

  it("normalizes case and spaces", () => {
    expect(normalizeTerm("  Bank   Account ")).toBe("bank account");
  });
});

describe("saveWord", () => {
  it("creates a card for every member including the author", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const bob = await makeUser(db, 2);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });

    const result = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft, now: T0 });
    if (result.status !== "saved") throw new Error("expected saved");
    expect(result.word).toMatchObject({ term: "Bank", termNormalized: "bank", translation: "берег" });
    expect(result.members).toHaveLength(2);
    expect(await db.select().from(cards)).toHaveLength(2);
  });

  it("rejects duplicates regardless of case and spaces", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft, now: T0 });
    const again = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { ...draft, term: " bank " }, now: T0 });
    expect(again).toEqual({ status: "duplicate" });
    expect(await findWord(db, room.id, "BANK")).toMatchObject({ term: "Bank" });
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/words.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/services/words.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words, type User, type Word } from "../db/schema";
import { createCards } from "./cards";
import { listMembers } from "./rooms";

export interface WordDraft {
  term: string;
  translation: string;
  explanation: string;
  example: string;
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "bank — берег" / "bank - берег" / "bank". Дефис без пробелов вокруг (well-known) — часть слова. */
export function parseAddInput(text: string): { term: string; translation?: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /^[—–-]/.test(trimmed)) return null;
  const m = /^(.+?)\s+[—–-]\s+(.+)$/s.exec(trimmed);
  if (!m) return { term: trimmed };
  return { term: m[1].trim(), translation: m[2].trim() };
}

export async function findWord(db: Db, roomId: number, term: string): Promise<Word | undefined> {
  const [word] = await db
    .select()
    .from(words)
    .where(and(eq(words.roomId, roomId), eq(words.termNormalized, normalizeTerm(term))));
  return word;
}

export async function getWord(db: Db, id: number): Promise<Word | undefined> {
  const [word] = await db.select().from(words).where(eq(words.id, id));
  return word;
}

export async function saveWord(
  db: Db,
  input: { roomId: number; addedBy: number; draft: WordDraft; now: Date },
): Promise<{ status: "duplicate" } | { status: "saved"; word: Word; members: User[] }> {
  if (await findWord(db, input.roomId, input.draft.term)) return { status: "duplicate" };
  const [word] = await db
    .insert(words)
    .values({
      roomId: input.roomId,
      addedBy: input.addedBy,
      term: input.draft.term.trim(),
      termNormalized: normalizeTerm(input.draft.term),
      translation: input.draft.translation,
      explanation: input.draft.explanation,
      example: input.draft.example,
      createdAt: input.now,
    })
    .returning();
  const members = await listMembers(db, input.roomId);
  await createCards(db, members.map((m) => m.id), [word.id], input.now);
  return { status: "saved", word, members };
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/words.test.ts && npm run typecheck`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/words.ts tests/words.test.ts
git commit -m "feat: words service"
```

---

### Task 8: Повторение

**Files:**
- Create: `src/services/review.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `review`, `Answer` (Task 3), таблицы `cards`, `words`, `reviewLogs`.
- Produces:
  - `interface DueItem { card: CardRow; word: Word }`
  - `LEARN_AHEAD_MS = 20 * 60_000`
  - `nextDue(db, userId: number, now: Date): Promise<DueItem | undefined>` — сначала карточки с `due <= now` (не-New по `due`, затем New по `createdAt`); если таких нет — то же самое с `due <= now + LEARN_AHEAD_MS`.
  - `countDue(db, userId: number, now: Date): Promise<number>` — только `due <= now`.
  - `getDueItemByCard(db, userId: number, cardId: number): Promise<DueItem | undefined>`
  - `answerCard(db, input: { userId: number; cardId: number; expectedReps: number; answer: Answer; now: Date }): Promise<"ok" | "stale">`
  - `markKnown(db, input: { userId: number; wordId: number; now: Date }): Promise<"ok" | "stale">` — только для карточки New с `reps === 0`.
  - `nextReviewAt(db, userId: number): Promise<Date | undefined>`

- [ ] **Step 1: Падающий тест**

`tests/review.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { reviewLogs } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard, countDue, markKnown, nextDue, nextReviewAt } from "../src/services/review";
import { saveWord } from "../src/services/words";
import { DAY, MIN, T0, at, makeUser, testDb } from "./helpers";

async function setup() {
  const db = testDb();
  const alice = await makeUser(db, 1);
  const bob = await makeUser(db, 2);
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
  const add = async (term: string, now = T0) => {
    const r = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now });
    if (r.status !== "saved") throw new Error("dup");
    return r.word;
  };
  return { db, alice, bob, room, add };
}

describe("review", () => {
  it("serves due reviews before new cards, new cards oldest first", async () => {
    const { db, bob, add } = await setup();
    await add("first", T0);
    await add("second", at(MIN));
    const old = await add("old", T0);
    // "old" отвечаем Easy → становится Review; через 30 дней она просрочена и должна идти первой.
    const oldItem = (await nextDue(db, bob.id, at(2 * MIN)))!;
    expect(oldItem.word.term).toBe("first");
    await markKnown(db, { userId: bob.id, wordId: old.id, now: T0 });
    const later = at(30 * DAY);
    expect((await nextDue(db, bob.id, later))!.word.term).toBe("old");
    expect(await countDue(db, bob.id, later)).toBe(3);
  });

  it("answers a card, logs it and rejects stale presses", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("ok");
    expect(await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
    expect(await db.select().from(reviewLogs)).toHaveLength(1);
  });

  it("does not let a user answer someone else's card", async () => {
    const { db, alice, bob, add } = await setup();
    await add("word");
    const bobsCard = (await nextDue(db, bob.id, T0))!.card;
    expect(await answerCard(db, { userId: alice.id, cardId: bobsCard.id, expectedReps: 0, answer: "good", now: T0 })).toBe("stale");
  });

  it("markKnown pushes a new card far ahead and works once", async () => {
    const { db, bob, add } = await setup();
    const word = await add("word");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("ok");
    expect(await markKnown(db, { userId: bob.id, wordId: word.id, now: T0 })).toBe("stale");
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const next = await nextReviewAt(db, bob.id);
    expect(next!.getTime() - T0.getTime()).toBeGreaterThanOrEqual(4 * DAY);
  });

  it("learns ahead: a just-failed card comes back in the same session", async () => {
    const { db, bob, add } = await setup();
    await add("word");
    const item = (await nextDue(db, bob.id, T0))!;
    await answerCard(db, { userId: bob.id, cardId: item.card.id, expectedReps: 0, answer: "again", now: T0 });
    expect(await countDue(db, bob.id, T0)).toBe(0);
    const again = await nextDue(db, bob.id, T0);
    expect(again?.card.id).toBe(item.card.id);
    expect(again?.card.state).not.toBe(State.New);
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/review.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/services/review.ts`:
```ts
import { and, asc, eq, lte } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, words, type CardRow, type Word } from "../db/schema";
import { review, type Answer } from "../srs/srs";

export interface DueItem {
  card: CardRow;
  word: Word;
}

export const LEARN_AHEAD_MS = 20 * 60_000;

function compareQueue(a: DueItem, b: DueItem): number {
  const aNew = a.card.state === State.New ? 1 : 0;
  const bNew = b.card.state === State.New ? 1 : 0;
  if (aNew !== bNew) return aNew - bNew;
  if (aNew) return a.card.createdAt.getTime() - b.card.createdAt.getTime() || a.card.id - b.card.id;
  return a.card.due.getTime() - b.card.due.getTime();
}

async function dueItems(db: Db, userId: number, until: Date): Promise<DueItem[]> {
  const rows = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, userId), lte(cards.due, until)));
  return rows.sort(compareQueue);
}

export async function nextDue(db: Db, userId: number, now: Date): Promise<DueItem | undefined> {
  const [item] = await dueItems(db, userId, now);
  if (item) return item;
  const [ahead] = await dueItems(db, userId, new Date(now.getTime() + LEARN_AHEAD_MS));
  return ahead;
}

export async function countDue(db: Db, userId: number, now: Date): Promise<number> {
  return (await dueItems(db, userId, now)).length;
}

export async function getDueItemByCard(db: Db, userId: number, cardId: number): Promise<DueItem | undefined> {
  const [row] = await db
    .select({ card: cards, word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
  return row;
}

async function applyAnswer(db: Db, card: CardRow, answer: Answer, now: Date): Promise<void> {
  await db.update(cards).set(review(card.fsrs, answer, now)).where(eq(cards.id, card.id));
  await db.insert(reviewLogs).values({ userId: card.userId, cardId: card.id, rating: answer, reviewedAt: now });
}

export async function answerCard(
  db: Db,
  input: { userId: number; cardId: number; expectedReps: number; answer: Answer; now: Date },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, input.cardId), eq(cards.userId, input.userId)));
  if (!card || card.reps !== input.expectedReps) return "stale";
  await applyAnswer(db, card, input.answer, input.now);
  return "ok";
}

export async function markKnown(
  db: Db,
  input: { userId: number; wordId: number; now: Date },
): Promise<"ok" | "stale"> {
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.wordId, input.wordId), eq(cards.userId, input.userId)));
  if (!card || card.state !== State.New || card.reps !== 0) return "stale";
  await applyAnswer(db, card, "easy", input.now);
  return "ok";
}

export async function nextReviewAt(db: Db, userId: number): Promise<Date | undefined> {
  const [row] = await db
    .select({ due: cards.due })
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(asc(cards.due))
    .limit(1);
  return row?.due;
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/review.test.ts && npm run typecheck`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/review.ts tests/review.test.ts
git commit -m "feat: review queue and answers"
```

---

### Task 9: Статистика

**Files:**
- Create: `src/services/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Consumes: `localParts`, `previousDate` (Task 4), `listMembers` (Task 6).
- Produces:
  - `LEARNED_STABILITY_DAYS = 21`; `isLearned(card: { state: number; stability: number }): boolean`
  - `computeStreak(dates: Set<string>, today: string): number` — серия жива, если был ответ сегодня или вчера.
  - `interface PersonalStats { total: number; learned: number; learning: number; fresh: number; reviews7d: number; streak: number }`
  - `personalStats(db, user: User, now: Date): Promise<PersonalStats>`
  - `interface LeaderRow { userId: number; name: string; learned: number; reviews7d: number }`
  - `roomLeaderboard(db, roomId: number, now: Date): Promise<LeaderRow[]>` — по `reviews7d` убыв., затем `learned` убыв.

- [ ] **Step 1: Падающий тест**

`tests/stats.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { answerCard } from "../src/services/review";
import { computeStreak, personalStats, roomLeaderboard } from "../src/services/stats";
import { saveWord } from "../src/services/words";
import { DAY, T0, at, makeUser, testDb } from "./helpers";

describe("computeStreak", () => {
  it("counts consecutive days ending today or yesterday", () => {
    expect(computeStreak(new Set(["2026-10-13", "2026-10-14", "2026-10-15"]), "2026-10-15")).toBe(3);
    expect(computeStreak(new Set(["2026-10-13", "2026-10-14"]), "2026-10-15")).toBe(2);
    expect(computeStreak(new Set(["2026-10-12"]), "2026-10-15")).toBe(0);
    expect(computeStreak(new Set(), "2026-10-15")).toBe(0);
  });
});

describe("stats", () => {
  it("computes personal stats and the room leaderboard", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1, "Alice");
    const bob = await makeUser(db, 2, "Bob");
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    for (const term of ["a", "b", "c"]) {
      await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term, translation: "t", explanation: "", example: "" }, now: T0 });
    }
    // Bob отвечает на две карточки в два разных дня.
    const bobCards = await db.select().from(cards).where(eq(cards.userId, bob.id)).orderBy(cards.id);
    await answerCard(db, { userId: bob.id, cardId: bobCards[0].id, expectedReps: 0, answer: "good", now: at(-DAY) });
    await answerCard(db, { userId: bob.id, cardId: bobCards[1].id, expectedReps: 0, answer: "good", now: T0 });
    // Делаем первую карточку «выученной».
    await db.update(cards).set({ state: 2, stability: 30 }).where(eq(cards.id, bobCards[0].id));

    const s = await personalStats(db, bob, T0);
    expect(s).toEqual({ total: 3, learned: 1, learning: 1, fresh: 1, reviews7d: 2, streak: 2 });

    const board = await roomLeaderboard(db, room.id, T0);
    expect(board.map((r) => r.name)).toEqual(["Bob", "Alice"]);
    expect(board[0]).toMatchObject({ learned: 1, reviews7d: 2 });
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/services/stats.ts`:
```ts
import { and, eq, gte } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, reviewLogs, words, type User } from "../db/schema";
import { localParts, previousDate } from "../time";
import { listMembers } from "./rooms";

export const LEARNED_STABILITY_DAYS = 21;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export function isLearned(card: { state: number; stability: number }): boolean {
  return card.state === State.Review && card.stability >= LEARNED_STABILITY_DAYS;
}

export function computeStreak(dates: Set<string>, today: string): number {
  let day = dates.has(today) ? today : previousDate(today);
  let streak = 0;
  while (dates.has(day)) {
    streak++;
    day = previousDate(day);
  }
  return streak;
}

export interface PersonalStats {
  total: number;
  learned: number;
  learning: number;
  fresh: number;
  reviews7d: number;
  streak: number;
}

export async function personalStats(db: Db, user: User, now: Date): Promise<PersonalStats> {
  const userCards = await db
    .select({ state: cards.state, stability: cards.stability })
    .from(cards)
    .where(eq(cards.userId, user.id));
  const logs = await db
    .select({ reviewedAt: reviewLogs.reviewedAt })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, user.id));

  const learned = userCards.filter(isLearned).length;
  const fresh = userCards.filter((c) => c.state === State.New).length;
  const weekAgo = now.getTime() - WEEK_MS;
  const dates = new Set(logs.map((l) => localParts(user.timezone, l.reviewedAt).date));

  return {
    total: userCards.length,
    learned,
    learning: userCards.length - learned - fresh,
    fresh,
    reviews7d: logs.filter((l) => l.reviewedAt.getTime() >= weekAgo).length,
    streak: computeStreak(dates, localParts(user.timezone, now).date),
  };
}

export interface LeaderRow {
  userId: number;
  name: string;
  learned: number;
  reviews7d: number;
}

export async function roomLeaderboard(db: Db, roomId: number, now: Date): Promise<LeaderRow[]> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const members = await listMembers(db, roomId);
  const rows: LeaderRow[] = [];
  for (const member of members) {
    const memberCards = await db
      .select({ state: cards.state, stability: cards.stability })
      .from(cards)
      .innerJoin(words, eq(cards.wordId, words.id))
      .where(and(eq(cards.userId, member.id), eq(words.roomId, roomId)));
    const recent = await db
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
      .innerJoin(words, eq(cards.wordId, words.id))
      .where(and(eq(reviewLogs.userId, member.id), eq(words.roomId, roomId), gte(reviewLogs.reviewedAt, weekAgo)));
    rows.push({ userId: member.id, name: member.firstName, learned: memberCards.filter(isLearned).length, reviews7d: recent.length });
  }
  return rows.sort((a, b) => b.reviews7d - a.reviews7d || b.learned - a.learned);
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/stats.test.ts && npm run typecheck`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/stats.ts tests/stats.test.ts
git commit -m "feat: personal stats and room leaderboard"
```

---

### Task 10: Сбор напоминаний

**Files:**
- Create: `src/services/reminders.ts`
- Test: `tests/reminders.test.ts`

**Interfaces:**
- Consumes: `localParts` (Task 4), `updateUser` (Task 5), `countDue` (Task 8).
- Produces: `interface Reminder { user: User; dueCount: number }`; `collectReminders(db, now: Date): Promise<Reminder[]>` — для пользователей с `canDm`, у которых локальное время ≥ `reminderTime` и `lastReminderDate` ≠ локальной дате; помечает `lastReminderDate` всем таким (даже без карточек); возвращает только тех, у кого `dueCount > 0`.

- [ ] **Step 1: Падающий тест**

`tests/reminders.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createRoom } from "../src/services/rooms";
import { collectReminders } from "../src/services/reminders";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

// Москва = UTC+3.
const msk = (iso: string) => new Date(`${iso}+03:00`);

async function setup(withWord = true) {
  const db = testDb();
  const alice = await makeUser(db, 1);
  await updateUser(db, alice.id, { canDm: true });
  const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
  if (withWord) {
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "a", translation: "t", explanation: "", example: "" }, now: T0 });
  }
  return { db, alice };
}

describe("collectReminders", () => {
  it("fires once per local day at or after reminder time", async () => {
    const { db } = await setup();
    expect(await collectReminders(db, msk("2026-10-15T19:59"))).toHaveLength(0);
    const fired = await collectReminders(db, msk("2026-10-15T20:00"));
    expect(fired).toHaveLength(1);
    expect(fired[0].dueCount).toBe(1);
    expect(await collectReminders(db, msk("2026-10-15T20:30"))).toHaveLength(0);
    expect(await collectReminders(db, msk("2026-10-16T20:05"))).toHaveLength(1);
  });

  it("catches up after downtime later the same evening", async () => {
    const { db } = await setup();
    expect(await collectReminders(db, msk("2026-10-15T23:40"))).toHaveLength(1);
  });

  it("skips users who cannot receive DMs", async () => {
    const { db, alice } = await setup();
    await updateUser(db, alice.id, { canDm: false });
    expect(await collectReminders(db, msk("2026-10-15T20:00"))).toHaveLength(0);
  });

  it("stays silent with nothing due and does not retry the same day", async () => {
    const { db } = await setup(false);
    expect(await collectReminders(db, msk("2026-10-15T20:00"))).toHaveLength(0);
    expect(await collectReminders(db, msk("2026-10-15T21:00"))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/reminders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/services/reminders.ts`:
```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users, type User } from "../db/schema";
import { localParts } from "../time";
import { countDue } from "./review";
import { updateUser } from "./users";

export interface Reminder {
  user: User;
  dueCount: number;
}

export async function collectReminders(db: Db, now: Date): Promise<Reminder[]> {
  const candidates = await db.select().from(users).where(eq(users.canDm, true));
  const reminders: Reminder[] = [];
  for (const user of candidates) {
    const { date, time } = localParts(user.timezone, now);
    if (time < user.reminderTime || user.lastReminderDate === date) continue;
    await updateUser(db, user.id, { lastReminderDate: date });
    const dueCount = await countDue(db, user.id, now);
    if (dueCount > 0) reminders.push({ user, dueCount });
  }
  return reminders;
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/reminders.test.ts && npm run typecheck`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/reminders.ts tests/reminders.test.ts
git commit -m "feat: daily reminder selection"
```

---

### Task 11: LLM-подсказки через Claude Code

**Files:**
- Create: `src/llm/enricher.ts`, `src/llm/claude-code.ts`, `scripts/try-enrich.ts`
- Test: `tests/enricher.test.ts`

**Interfaces:**
- Produces:
  - `interface Enrichment { translation: string; explanation: string; example: string }`
  - `interface WordEnricher { enrich(term: string, translationHint?: string): Promise<Enrichment> }`
  - `SYSTEM_PROMPT: string`; `buildPrompt(term: string, translationHint?: string): string`
  - `parseEnrichment(text: string): Enrichment` — бросает при невалидном ответе.
  - `class ClaudeCodeEnricher implements WordEnricher { constructor(opts: { model: string; timeoutMs: number }) }`

- [ ] **Step 1: Падающий тест**

`tests/enricher.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildPrompt, parseEnrichment } from "../src/llm/enricher";

const ok = { translation: "счастливая случайность", explanation: "Удачное открытие.", example: "It was pure serendipity." };

describe("parseEnrichment", () => {
  it("parses plain JSON", () => {
    expect(parseEnrichment(JSON.stringify(ok))).toEqual(ok);
  });

  it("parses JSON wrapped in a code fence with chatter", () => {
    expect(parseEnrichment("Вот ответ:\n```json\n" + JSON.stringify(ok) + "\n```")).toEqual(ok);
  });

  it("throws on garbage and on missing translation", () => {
    expect(() => parseEnrichment("не знаю")).toThrow();
    expect(() => parseEnrichment(JSON.stringify({ ...ok, translation: "" }))).toThrow();
  });
});

describe("buildPrompt", () => {
  it("includes the term and the hint", () => {
    const p = buildPrompt("bank", "берег");
    expect(p).toContain('"bank"');
    expect(p).toContain('"берег"');
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/enricher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: enricher.ts**

`src/llm/enricher.ts`:
```ts
import { z } from "zod";

export interface Enrichment {
  translation: string;
  explanation: string;
  example: string;
}

export interface WordEnricher {
  enrich(term: string, translationHint?: string): Promise<Enrichment>;
}

const enrichmentSchema = z.object({
  translation: z.string().trim().min(1),
  explanation: z.string().trim().default(""),
  example: z.string().trim().default(""),
});

export const SYSTEM_PROMPT =
  "Ты помогаешь русскоязычным людям учить английский. Отвечай строго одним JSON-объектом, без пояснений и без markdown.";

export function buildPrompt(term: string, translationHint?: string): string {
  return [
    `Английское слово или фраза: "${term}".`,
    translationHint ? `Пользователь имеет в виду значение "${translationHint}" — опиши именно его.` : "",
    'Верни JSON: {"translation": "...", "explanation": "...", "example": "..."}, где',
    "translation — краткий перевод на русский (1–3 самых частых значения через запятую),",
    "explanation — объяснение значения на русском в одном предложении,",
    "example — короткое естественное предложение на английском с этим словом.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseEnrichment(text: string): Enrichment {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`No JSON in LLM response: ${text.slice(0, 200)}`);
  return enrichmentSchema.parse(JSON.parse(text.slice(start, end + 1)));
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/enricher.test.ts`
Expected: 4 passed.

- [ ] **Step 5: claude-code.ts**

`src/llm/claude-code.ts`:
```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt, parseEnrichment, SYSTEM_PROMPT, type Enrichment, type WordEnricher } from "./enricher";

/** Ходит в локальный Claude Code через Agent SDK (авторизация Claude Code, без API-ключа). */
export class ClaudeCodeEnricher implements WordEnricher {
  constructor(private readonly opts: { model: string; timeoutMs: number }) {}

  async enrich(term: string, translationHint?: string): Promise<Enrichment> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.opts.timeoutMs);
    try {
      let result: string | undefined;
      for await (const message of query({
        prompt: buildPrompt(term, translationHint),
        options: {
          abortController,
          model: this.opts.model,
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 1,
          allowedTools: [],
        },
      })) {
        if (message.type === "result") {
          if (message.subtype !== "success") throw new Error(`Claude Code failed: ${message.subtype}`);
          result = message.result;
        }
      }
      if (result === undefined) throw new Error("Claude Code returned no result");
      return parseEnrichment(result);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

Если typecheck ругается на какое-то поле `options` (API Agent SDK менялось), свериться с `node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts` и подправить имя поля, сохранив смысл: одна реплика, без инструментов, системный промпт, модель, отмена по таймауту.

- [ ] **Step 6: Скрипт ручной проверки**

`scripts/try-enrich.ts`:
```ts
import { ClaudeCodeEnricher } from "../src/llm/claude-code";

const term = process.argv[2] ?? "serendipity";
const enricher = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const started = Date.now();
console.log(await enricher.enrich(term, process.argv[3]));
console.log(`took ${Date.now() - started} ms`);
```

Run: `npx tsx scripts/try-enrich.ts serendipity`
Expected: объект с `translation/explanation/example` на русском/английском и время выполнения. Если падает с ошибкой авторизации — в отчёте указать, что нужно выполнить `claude` и залогиниться (это делает пользователь); тесты при этом не блокируются.

- [ ] **Step 7: Typecheck и commit**

Run: `npm run typecheck`

```bash
git add src/llm scripts tests/enricher.test.ts
git commit -m "feat: word enrichment via Claude Agent SDK"
```

---

### Task 12: Notifier

**Files:**
- Create: `src/notifier.ts`
- Test: `tests/notifier.test.ts`

**Interfaces:**
- Consumes: `updateUser` (Task 5).
- Produces: `type SendOptions = Record<string, unknown>`; `interface SendApi { sendMessage(chatId: number, text: string, other?: SendOptions): Promise<unknown> }`; `class Notifier { constructor(api: SendApi, db: Db); dm(user: User, text: string, other?: SendOptions): Promise<boolean>; group(chatId: number, text: string, other?: SendOptions): Promise<boolean> }`.

- [ ] **Step 1: Падающий тест**

`tests/notifier.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Notifier, type SendApi } from "../src/notifier";
import { getUser, updateUser } from "../src/services/users";
import { makeUser, testDb } from "./helpers";

function fakeApi(fail?: { error_code: number }) {
  const sent: Array<{ chatId: number; text: string }> = [];
  const api: SendApi = {
    async sendMessage(chatId, text) {
      if (fail) throw Object.assign(new Error("tg"), fail);
      sent.push({ chatId, text });
    },
  };
  return { api, sent };
}

describe("Notifier", () => {
  it("sends DMs only to users who started the bot", async () => {
    const db = testDb();
    const user = await makeUser(db, 7);
    const { api, sent } = fakeApi();
    const notifier = new Notifier(api, db);
    expect(await notifier.dm(user, "hi")).toBe(false);
    const enabled = await updateUser(db, user.id, { canDm: true });
    expect(await notifier.dm(enabled, "hi")).toBe(true);
    expect(sent).toEqual([{ chatId: 7, text: "hi" }]);
  });

  it("disables DMs when the user blocked the bot", async () => {
    const db = testDb();
    const user = await updateUser(db, (await makeUser(db, 7)).id, { canDm: true });
    const notifier = new Notifier(fakeApi({ error_code: 403 }).api, db);
    expect(await notifier.dm(user, "hi")).toBe(false);
    expect((await getUser(db, user.id))?.canDm).toBe(false);
  });

  it("does not throw when a group send fails", async () => {
    const db = testDb();
    const notifier = new Notifier(fakeApi({ error_code: 400 }).api, db);
    expect(await notifier.group(-100, "hi")).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/notifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Реализация**

`src/notifier.ts`:
```ts
import type { Db } from "./db/client";
import type { User } from "./db/schema";
import { updateUser } from "./services/users";

export type SendOptions = Record<string, unknown>;

export interface SendApi {
  sendMessage(chatId: number, text: string, other?: SendOptions): Promise<unknown>;
}

function errorCode(err: unknown): unknown {
  return typeof err === "object" && err !== null && "error_code" in err
    ? (err as { error_code: unknown }).error_code
    : undefined;
}

export class Notifier {
  constructor(
    private readonly api: SendApi,
    private readonly db: Db,
  ) {}

  async dm(user: User, text: string, other?: SendOptions): Promise<boolean> {
    if (!user.canDm) return false;
    try {
      await this.api.sendMessage(user.telegramId, text, other);
      return true;
    } catch (err) {
      if (errorCode(err) === 403) {
        await updateUser(this.db, user.id, { canDm: false });
      } else {
        console.error("DM failed", user.telegramId, err);
      }
      return false;
    }
  }

  async group(chatId: number, text: string, other?: SendOptions): Promise<boolean> {
    try {
      await this.api.sendMessage(chatId, text, other);
      return true;
    } catch (err) {
      console.error("Group send failed", chatId, err);
      return false;
    }
  }
}
```

- [ ] **Step 4: Запустить — PASS**

Run: `npx vitest run tests/notifier.test.ts && npm run typecheck`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/notifier.ts tests/notifier.test.ts
git commit -m "feat: notifier with blocked-user handling"
```

---

### Task 13: Чистые части бота — колбэки, тексты, клавиатуры, черновики

**Files:**
- Create: `src/bot/callbacks.ts`, `src/bot/texts.ts`, `src/bot/keyboards.ts`, `src/bot/drafts.ts`
- Test: `tests/bot-pure.test.ts`

**Interfaces:**
- Consumes: `Answer` (Task 3), `Word`, `Room` (Task 2), `PersonalStats`, `LeaderRow` (Task 9), `WordDraft` (Task 7).
- Produces:
  - `type Cb = { k: "know"; wordId: number; knows: boolean } | { k: "show"; cardId: number; reps: number } | { k: "rate"; cardId: number; reps: number; answer: Answer } | { k: "learn" } | { k: "draft"; id: number; action: "ok" | "edit" | "cancel" } | { k: "room"; action: "new" | "invite" } | { k: "roomsw"; roomId: number } | { k: "hour"; hour: number }`; `encodeCb(cb: Cb): string`; `decodeCb(data: string): Cb | null`
  - тексты: `esc`, `plural`, `formatDateTime(date, timeZone)`, `draftText(d: WordDraft)`, `cardFront(word)`, `knowPrompt(adderName, word, roomName)`, `announceText(adderName, word)`, `reminderText(n)`, `doneText(reviewed, next: Date | undefined, timeZone)`, `statsText(stats, roomName?, board?)`, `welcomeText()`
  - клавиатуры: `knowKeyboard(wordId)`, `showKeyboard(cardId, reps)`, `rateKeyboard(cardId, reps, isNew)`, `learnKeyboard()`, `draftKeyboard(draftId)`, `roomKeyboard(otherRooms: Room[], hasCurrent: boolean)`, `hoursKeyboard()`
  - `interface Draft extends WordDraft { id: number; userId: number; chatId: number; roomId: number; awaitingEdit: boolean }`; `class DraftStore { create(d: Omit<Draft, "id" | "awaitingEdit">): Draft; get(id): Draft | undefined; findAwaiting(userId, chatId): Draft | undefined; delete(id): void }`

- [ ] **Step 1: Падающий тест**

`tests/bot-pure.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeCb, encodeCb, type Cb } from "../src/bot/callbacks";
import { DraftStore } from "../src/bot/drafts";
import { doneText, draftText, esc, plural, reminderText, statsText } from "../src/bot/texts";

describe("callbacks", () => {
  const all: Cb[] = [
    { k: "know", wordId: 5, knows: true },
    { k: "know", wordId: 5, knows: false },
    { k: "show", cardId: 9, reps: 2 },
    { k: "rate", cardId: 9, reps: 2, answer: "hard" },
    { k: "learn" },
    { k: "draft", id: 3, action: "edit" },
    { k: "room", action: "invite" },
    { k: "roomsw", roomId: 4 },
    { k: "hour", hour: 21 },
  ];
  it("round-trips and fits Telegram's 64-byte limit", () => {
    for (const cb of all) {
      const data = encodeCb(cb);
      expect(data.length).toBeLessThanOrEqual(64);
      expect(decodeCb(data)).toEqual(cb);
    }
  });
  it("rejects garbage", () => {
    expect(decodeCb("zzz")).toBeNull();
    expect(decodeCb("r:1:2:x")).toBeNull();
    expect(decodeCb("s:abc:1")).toBeNull();
  });
});

describe("texts", () => {
  it("escapes HTML in user content", () => {
    expect(esc("R&D <3")).toBe("R&amp;D &lt;3");
    expect(draftText({ term: "<b>", translation: "R&D", explanation: "", example: "" })).toBe("<b>&lt;b&gt;</b> — R&amp;D");
  });
  it("pluralizes in Russian", () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, "слово", "слова", "слов"))).toEqual([
      "слово", "слова", "слов", "слов", "слово", "слова",
    ]);
    expect(reminderText(1)).toContain("1 слово ждёт");
    expect(reminderText(12)).toContain("12 слов ждут");
  });
  it("renders done and stats texts", () => {
    expect(doneText(0, undefined, "Europe/Moscow")).toContain("нечего повторять");
    expect(doneText(3, new Date("2026-10-16T17:00:00Z"), "Europe/Moscow")).toContain("16.10, 20:00");
    const text = statsText({ total: 3, learned: 1, learning: 1, fresh: 1, reviews7d: 2, streak: 2 }, "R", [
      { userId: 1, name: "Bob", learned: 1, reviews7d: 2 },
    ]);
    expect(text).toContain("Выучено: 1");
    expect(text).toContain("1. Bob");
  });
});

describe("DraftStore", () => {
  it("keeps one draft per user and finds the one awaiting an edit", () => {
    const store = new DraftStore();
    const base = { userId: 1, chatId: 10, roomId: 1, term: "a", translation: "", explanation: "", example: "" };
    const first = store.create(base);
    const second = store.create({ ...base, term: "b" });
    expect(store.get(first.id)).toBeUndefined();
    second.awaitingEdit = true;
    expect(store.findAwaiting(1, 10)?.term).toBe("b");
    expect(store.findAwaiting(1, 11)).toBeUndefined();
    store.delete(second.id);
    expect(store.get(second.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить — FAIL**

Run: `npx vitest run tests/bot-pure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: callbacks.ts**

`src/bot/callbacks.ts`:
```ts
import type { Answer } from "../srs/srs";

export type Cb =
  | { k: "know"; wordId: number; knows: boolean }
  | { k: "show"; cardId: number; reps: number }
  | { k: "rate"; cardId: number; reps: number; answer: Answer }
  | { k: "learn" }
  | { k: "draft"; id: number; action: "ok" | "edit" | "cancel" }
  | { k: "room"; action: "new" | "invite" }
  | { k: "roomsw"; roomId: number }
  | { k: "hour"; hour: number };

const ANSWERS: Record<string, Answer> = { a: "again", h: "hard", g: "good", e: "easy" };
const DRAFT_ACTIONS = { o: "ok", e: "edit", c: "cancel" } as const;
const ROOM_ACTIONS = { n: "new", i: "invite" } as const;

const short = <T extends string>(map: Record<string, T>, value: T) =>
  Object.keys(map).find((key) => map[key] === value)!;

export function encodeCb(cb: Cb): string {
  switch (cb.k) {
    case "know": return `k:${cb.wordId}:${cb.knows ? "y" : "n"}`;
    case "show": return `s:${cb.cardId}:${cb.reps}`;
    case "rate": return `r:${cb.cardId}:${cb.reps}:${short(ANSWERS, cb.answer)}`;
    case "learn": return "l";
    case "draft": return `d:${cb.id}:${short(DRAFT_ACTIONS, cb.action)}`;
    case "room": return `rm:${short(ROOM_ACTIONS, cb.action)}`;
    case "roomsw": return `rs:${cb.roomId}`;
    case "hour": return `t:${cb.hour}`;
  }
}

const int = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

export function decodeCb(data: string): Cb | null {
  const [tag, a, b, c] = data.split(":");
  switch (tag) {
    case "k": {
      const wordId = int(a);
      return wordId !== null && (b === "y" || b === "n") ? { k: "know", wordId, knows: b === "y" } : null;
    }
    case "s": {
      const cardId = int(a), reps = int(b);
      return cardId !== null && reps !== null ? { k: "show", cardId, reps } : null;
    }
    case "r": {
      const cardId = int(a), reps = int(b), answer = c ? ANSWERS[c] : undefined;
      return cardId !== null && reps !== null && answer ? { k: "rate", cardId, reps, answer } : null;
    }
    case "l": return { k: "learn" };
    case "d": {
      const id = int(a), action = b ? DRAFT_ACTIONS[b as keyof typeof DRAFT_ACTIONS] : undefined;
      return id !== null && action ? { k: "draft", id, action } : null;
    }
    case "rm": {
      const action = a ? ROOM_ACTIONS[a as keyof typeof ROOM_ACTIONS] : undefined;
      return action ? { k: "room", action } : null;
    }
    case "rs": {
      const roomId = int(a);
      return roomId !== null ? { k: "roomsw", roomId } : null;
    }
    case "t": {
      const hour = int(a);
      return hour !== null && hour < 24 ? { k: "hour", hour } : null;
    }
    default: return null;
  }
}
```

- [ ] **Step 4: texts.ts**

`src/bot/texts.ts`:
```ts
import type { Word } from "../db/schema";
import type { LeaderRow, PersonalStats } from "../services/stats";
import type { WordDraft } from "../services/words";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function draftText(d: WordDraft): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  return text;
}

export function cardFront(word: Word): string {
  return `<b>${esc(word.term)}</b>\n\nВспомни перевод и нажми «Показать»`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b>\n\nЗнаешь это слово?`;
}

export function announceText(adderName: string, word: Word): string {
  return `📥 ${esc(adderName)} добавил(а) слово\n\n${draftText(word)}`;
}

export function reminderText(n: number): string {
  return `🔔 ${n} ${plural(n, "слово", "слова", "слов")} ${n % 10 === 1 && n % 100 !== 11 ? "ждёт" : "ждут"} повторения`;
}

export function doneText(reviewed: number, next: Date | undefined, timeZone: string): string {
  const head = reviewed > 0 ? `🎉 Готово! Повторено: ${reviewed}.` : "Сейчас нечего повторять 👌";
  return next ? `${head}\nСледующее повторение: ${formatDateTime(next, timeZone)}` : head;
}

export function statsText(s: PersonalStats, roomName?: string, board?: LeaderRow[]): string {
  const lines = [
    "📊 <b>Твой прогресс</b>",
    `Всего слов: ${s.total}`,
    `✅ Выучено: ${s.learned}`,
    `📖 В процессе: ${s.learning}`,
    `🆕 Новых: ${s.fresh}`,
    `🔁 Повторений за неделю: ${s.reviews7d}`,
    `🔥 Серия: ${s.streak} ${plural(s.streak, "день", "дня", "дней")}`,
  ];
  if (roomName && board?.length) {
    lines.push("", `🏠 <b>${esc(roomName)}</b> — за неделю`);
    board.forEach((r, i) => lines.push(`${i + 1}. ${esc(r.name)} — ${r.reviews7d} повт., ${r.learned} выуч.`));
  }
  return lines.join("\n");
}

export function welcomeText(): string {
  return [
    "👋 Привет! Я помогаю учить английские слова вместе с друзьями.",
    "",
    "/room — твои комнаты и приглашения",
    "/newroom название — создать комнату",
    "/add слово — добавить слово (можно с переводом: bank — берег)",
    "/learn — повторить слова",
    "/stats — прогресс твой и друзей",
    "/settings — время напоминания",
    "/link — в группе: привязать её к комнате",
  ].join("\n");
}
```

- [ ] **Step 5: keyboards.ts**

`src/bot/keyboards.ts`:
```ts
import { InlineKeyboard } from "grammy";
import type { Room } from "../db/schema";
import { encodeCb } from "./callbacks";

export function knowKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Знаю", encodeCb({ k: "know", wordId, knows: true }))
    .text("📚 Не знаю", encodeCb({ k: "know", wordId, knows: false }));
}

export function showKeyboard(cardId: number, reps: number): InlineKeyboard {
  return new InlineKeyboard().text("👀 Показать", encodeCb({ k: "show", cardId, reps }));
}

export function rateKeyboard(cardId: number, reps: number, isNew: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("😵 Забыл", encodeCb({ k: "rate", cardId, reps, answer: "again" }))
    .text("😐 С трудом", encodeCb({ k: "rate", cardId, reps, answer: "hard" }))
    .text("😎 Помню", encodeCb({ k: "rate", cardId, reps, answer: "good" }));
  if (isNew) kb.row().text("✅ Уже знаю", encodeCb({ k: "rate", cardId, reps, answer: "easy" }));
  return kb;
}

export function learnKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("▶️ Начать", encodeCb({ k: "learn" }));
}

export function draftKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Ок", encodeCb({ k: "draft", id, action: "ok" }))
    .text("✏️ Исправить", encodeCb({ k: "draft", id, action: "edit" }))
    .text("❌ Отмена", encodeCb({ k: "draft", id, action: "cancel" }));
}

export function roomKeyboard(otherRooms: Room[], hasCurrent: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasCurrent) kb.text("🔗 Пригласить", encodeCb({ k: "room", action: "invite" }));
  kb.text("➕ Новая комната", encodeCb({ k: "room", action: "new" }));
  for (const room of otherRooms) kb.row().text(`→ ${room.name}`, encodeCb({ k: "roomsw", roomId: room.id }));
  return kb;
}

const HOURS = [8, 9, 12, 18, 19, 20, 21, 22];

export function hoursKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  HOURS.forEach((hour, i) => {
    if (i === 4) kb.row();
    kb.text(`${String(hour).padStart(2, "0")}:00`, encodeCb({ k: "hour", hour }));
  });
  return kb;
}
```

- [ ] **Step 6: drafts.ts**

`src/bot/drafts.ts`:
```ts
import type { WordDraft } from "../services/words";

export interface Draft extends WordDraft {
  id: number;
  userId: number;
  chatId: number;
  roomId: number;
  awaitingEdit: boolean;
}

/** Черновики живут в памяти: после перезапуска бота слово нужно добавить заново. */
export class DraftStore {
  private seq = 0;
  private readonly drafts = new Map<number, Draft>();

  create(input: Omit<Draft, "id" | "awaitingEdit">): Draft {
    for (const [id, d] of this.drafts) if (d.userId === input.userId) this.drafts.delete(id);
    const draft: Draft = { ...input, id: ++this.seq, awaitingEdit: false };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  get(id: number): Draft | undefined {
    return this.drafts.get(id);
  }

  findAwaiting(userId: number, chatId: number): Draft | undefined {
    for (const d of this.drafts.values()) if (d.userId === userId && d.chatId === chatId && d.awaitingEdit) return d;
    return undefined;
  }

  delete(id: number): void {
    this.drafts.delete(id);
  }
}
```

- [ ] **Step 7: Запустить — PASS**

Run: `npx vitest run tests/bot-pure.test.ts && npm run typecheck`
Expected: все тесты зелёные. Если строка в `doneText` отличается форматом (например, `16.10 20:00` без запятой в данной версии ICU) — подстроить ожидание теста под фактический формат `Intl` и указать это в отчёте.

- [ ] **Step 8: Commit**

```bash
git add src/bot tests/bot-pure.test.ts
git commit -m "feat: bot callbacks, texts, keyboards and drafts"
```

---

### Task 14: Сборка бота — контекст, middleware, комнаты, точка входа

**Files:**
- Create: `src/bot/context.ts`, `src/bot/middleware.ts`, `src/bot/handlers/rooms.ts`, `src/bot/setup.ts`, `src/index.ts`

**Interfaces:**
- Consumes: всё из Tasks 2–13.
- Produces: `type BotContext = Context & { user: User }`; `interface Deps { db: Db; enricher: WordEnricher; notifier: Notifier; drafts: DraftStore; now: () => Date; botUsername: string }`; `inviteLink(botUsername, room): string`; `setupBot(bot: Bot<BotContext>, deps: Deps): void`; `COMMANDS`; функции регистрации `registerRooms(bot, deps)` (Tasks 15–17 добавляют `registerAdd`, `registerLearn`, `registerStats` и подключают их в `setup.ts`).

- [ ] **Step 1: context.ts**

`src/bot/context.ts`:
```ts
import type { Context } from "grammy";
import type { Db } from "../db/client";
import type { Room, User } from "../db/schema";
import type { WordEnricher } from "../llm/enricher";
import type { Notifier } from "../notifier";
import type { DraftStore } from "./drafts";

export type BotContext = Context & { user: User };

export interface Deps {
  db: Db;
  enricher: WordEnricher;
  notifier: Notifier;
  drafts: DraftStore;
  now: () => Date;
  botUsername: string;
}

export const HTML = { parse_mode: "HTML" } as const;

export function inviteLink(botUsername: string, room: Room): string {
  return `https://t.me/${botUsername}?start=join_${room.inviteCode}`;
}
```

- [ ] **Step 2: middleware.ts**

`src/bot/middleware.ts`:
```ts
import type { MiddlewareFn } from "grammy";
import { findRoomByChat, joinRoom } from "../services/rooms";
import { updateUser, upsertUser } from "../services/users";
import type { BotContext, Deps } from "./context";
import { esc } from "./texts";

/** Регистрирует пользователя, отмечает возможность писать в личку и добавляет в комнату привязанной группы. */
export function userMiddleware(deps: Deps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    let user = await upsertUser(deps.db, ctx.from, deps.now());
    if (ctx.chat?.type === "private" && !user.canDm) user = await updateUser(deps.db, user.id, { canDm: true });
    ctx.user = user;

    if (ctx.chat && ctx.chat.type !== "private") {
      const room = await findRoomByChat(deps.db, ctx.chat.id);
      if (room) {
        await joinRoom(deps.db, { roomId: room.id, userId: user.id, now: deps.now(), makeCurrent: false });
        if (!user.canDm && !user.groupHintSent) {
          await ctx.reply(
            `${esc(user.firstName)}, чтобы получать новые слова и напоминания, открой https://t.me/${deps.botUsername} и нажми Start`,
          );
          ctx.user = await updateUser(deps.db, user.id, { groupHintSent: true });
        }
      }
    }
    await next();
  };
}
```

- [ ] **Step 3: handlers/rooms.ts**

`src/bot/handlers/rooms.ts`:
```ts
import type { Bot } from "grammy";
import type { User } from "../../db/schema";
import {
  createRoom, findRoomByChat, findRoomByInvite, getRoom, isMember, joinRoom, linkGroup, listMembers, listUserRooms,
} from "../../services/rooms";
import { getUser, updateUser } from "../../services/users";
import { decodeCb } from "../callbacks";
import { HTML, inviteLink, type BotContext, type Deps } from "../context";
import { roomKeyboard } from "../keyboards";
import { esc, welcomeText } from "../texts";

async function roomMenu(deps: Deps, user: User) {
  const rooms = await listUserRooms(deps.db, user.id);
  if (rooms.length === 0) {
    return {
      text: "У тебя пока нет комнат. Создай свою или попроси у друга ссылку-приглашение.",
      kb: roomKeyboard([], false),
    };
  }
  const current = rooms.find((r) => r.id === user.currentRoomId) ?? rooms[0];
  const members = await listMembers(deps.db, current.id);
  const text = [
    `🏠 Текущая комната: <b>${esc(current.name)}</b>`,
    `Участники: ${members.map((m) => esc(m.firstName)).join(", ")}`,
    current.telegramChatId != null ? "🔗 Привязана к группе" : "",
  ].filter(Boolean).join("\n");
  return { text, kb: roomKeyboard(rooms.filter((r) => r.id !== current.id), true) };
}

async function createDefaultRoom(ctx: BotContext, deps: Deps, name: string) {
  const room = await createRoom(deps.db, { name, createdBy: ctx.user.id, now: deps.now() });
  await ctx.reply(
    `🎉 Комната «${esc(room.name)}» создана и выбрана текущей.\nПришли друзьям ссылку: ${inviteLink(deps.botUsername, room)}`,
    HTML,
  );
}

export function registerRooms(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("join_")) {
      const room = await findRoomByInvite(deps.db, payload.slice("join_".length));
      if (!room) return void (await ctx.reply("Ссылка-приглашение недействительна 🤷"));
      const joined = await joinRoom(deps.db, { roomId: room.id, userId: ctx.user.id, now: deps.now(), makeCurrent: true });
      await ctx.reply(
        joined
          ? `🎉 Ты в комнате «${esc(room.name)}»! Все её слова уже ждут тебя в /learn.\nДобавляй свои через /add.`
          : `Ты уже в комнате «${esc(room.name)}», она выбрана текущей.`,
        HTML,
      );
      return;
    }
    await ctx.reply(welcomeText(), HTML);
  });

  bot.command("room", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply("Управлять комнатами можно в личке со мной"));
    const { text, kb } = await roomMenu(deps, ctx.user);
    await ctx.reply(text, { ...HTML, reply_markup: kb });
  });

  bot.command("newroom", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply("Создать комнату можно в личке со мной"));
    await createDefaultRoom(ctx, deps, ctx.match.trim() || `Комната ${ctx.user.firstName}`);
  });

  bot.callbackQuery(/^rm:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "room") return;
    if (cb.action === "new") return createDefaultRoom(ctx, deps, `Комната ${ctx.user.firstName}`);
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) return void (await ctx.reply("Сначала создай комнату: /newroom"));
    await ctx.reply(`Ссылка-приглашение в «${esc(room.name)}»:\n${inviteLink(deps.botUsername, room)}`, HTML);
  });

  bot.callbackQuery(/^rs:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "roomsw" || !(await isMember(deps.db, cb.roomId, ctx.user.id))) {
      return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    }
    const user = await updateUser(deps.db, ctx.user.id, { currentRoomId: cb.roomId });
    await ctx.answerCallbackQuery({ text: "Комната переключена" });
    const { text, kb } = await roomMenu(deps, user);
    await ctx.editMessageText(text, { ...HTML, reply_markup: kb });
  });

  bot.command("link", async (ctx) => {
    if (ctx.chat.type === "private") {
      return void (await ctx.reply("Отправь /link в группе, которую хочешь привязать к своей текущей комнате"));
    }
    const existing = await findRoomByChat(deps.db, ctx.chat.id);
    if (existing) return void (await ctx.reply(`Группа уже привязана к «${esc(existing.name)}»`, HTML));

    const user = await getUser(deps.db, ctx.user.id);
    if (user?.currentRoomId == null) {
      const room = await createRoom(deps.db, {
        name: "title" in ctx.chat ? ctx.chat.title : "Группа",
        createdBy: ctx.user.id,
        now: deps.now(),
        telegramChatId: ctx.chat.id,
      });
      return void (await ctx.reply(`🔗 Создал комнату «${esc(room.name)}» для этой группы. Добавляйте слова через /add`, HTML));
    }
    const result = await linkGroup(deps.db, user.currentRoomId, ctx.chat.id);
    const room = await getRoom(deps.db, user.currentRoomId);
    if (result === "room_has_group") {
      await ctx.reply("Твоя текущая комната уже привязана к другой группе. Создай новую (/newroom) или переключись в /room — в личке.");
      return;
    }
    await ctx.reply(`🔗 Группа привязана к «${esc(room?.name ?? "")}». Добавляйте слова через /add`, HTML);
  });
}
```

- [ ] **Step 4: setup.ts**

`src/bot/setup.ts`:
```ts
import type { Bot } from "grammy";
import type { BotContext, Deps } from "./context";
import { registerRooms } from "./handlers/rooms";
import { userMiddleware } from "./middleware";

export const COMMANDS = [
  { command: "learn", description: "Повторить слова" },
  { command: "add", description: "Добавить слово" },
  { command: "stats", description: "Прогресс твой и друзей" },
  { command: "room", description: "Комнаты и приглашения" },
  { command: "newroom", description: "Создать комнату" },
  { command: "settings", description: "Время напоминания" },
  { command: "link", description: "Привязать группу к комнате" },
];

export function setupBot(bot: Bot<BotContext>, deps: Deps): void {
  bot.use(userMiddleware(deps));
  registerRooms(bot, deps);
  // Неизвестные/устаревшие кнопки — просто гасим «часики».
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery());
  bot.catch(async (err) => {
    console.error("Bot error", err.error);
    await err.ctx.reply("Что-то пошло не так 😔").catch(() => {});
  });
}
```

- [ ] **Step 5: index.ts**

`src/index.ts`:
```ts
import { Bot } from "grammy";
import { setupBot, COMMANDS } from "./bot/setup";
import type { BotContext } from "./bot/context";
import { DraftStore } from "./bot/drafts";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { ClaudeCodeEnricher } from "./llm/claude-code";
import { Notifier } from "./notifier";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен — переменные можно передать окружением.
}

const config = loadConfig();
const db = createDb(config.dbPath);
const bot = new Bot<BotContext>(config.botToken);
const notifier = new Notifier(
  { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as Parameters<typeof bot.api.sendMessage>[2]) },
  db,
);
const now = () => new Date();

await bot.init();
setupBot(bot, {
  db,
  notifier,
  now,
  enricher: new ClaudeCodeEnricher({ model: config.enrichModel, timeoutMs: config.enrichTimeoutMs }),
  drafts: new DraftStore(),
  botUsername: bot.botInfo.username,
});
await bot.api.setMyCommands(COMMANDS);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

console.log(`@${bot.botInfo.username} started`);
await bot.start();
```

- [ ] **Step 6: Typecheck и тесты**

Run: `npm run typecheck && npm test`
Expected: без ошибок, все тесты зелёные.

- [ ] **Step 7: Ручная проверка (нужен токен тестового бота в `.env`)**

Если `.env` с `BOT_TOKEN` нет — пропустить шаг и указать в отчёте, что ручную проверку делает пользователь. Иначе `npm start`, затем:
1. `/start` в личке → приветствие со списком команд.
2. `/newroom Друзья` → сообщение со ссылкой-приглашением.
3. Открыть ссылку со второго аккаунта → «Ты в комнате «Друзья»».
4. `/room` → участники обоих аккаунтов, кнопки работают.
5. Добавить бота в группу, `/link` → «Группа привязана…».

- [ ] **Step 8: Commit**

```bash
git add src/bot/context.ts src/bot/middleware.ts src/bot/handlers/rooms.ts src/bot/setup.ts src/index.ts
git commit -m "feat: bot wiring, rooms commands and entry point"
```

---

### Task 15: Добавление слова

**Files:**
- Create: `src/bot/handlers/add.ts`
- Modify: `src/bot/setup.ts` (подключить `registerAdd` последним перед fallback-обработчиком колбэков)

**Interfaces:**
- Consumes: `parseAddInput`, `findWord`, `saveWord` (Task 7), `getRoom`, `findRoomByChat` (Task 6), `DraftStore` и тексты/клавиатуры (Task 13), `Deps`, `HTML` (Task 14).
- Produces: `registerAdd(bot: Bot<BotContext>, deps: Deps): void`.

- [ ] **Step 1: Реализация**

`src/bot/handlers/add.ts`:
```ts
import type { Bot } from "grammy";
import type { Room, User, Word } from "../../db/schema";
import type { Enrichment } from "../../llm/enricher";
import { findRoomByChat, getRoom } from "../../services/rooms";
import { findWord, parseAddInput, saveWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import type { Draft } from "../drafts";
import { draftKeyboard, knowKeyboard } from "../keyboards";
import { announceText, draftText, esc, knowPrompt } from "../texts";

const USAGE = "Напиши слово после команды: /add serendipity\nМожно сразу с переводом: /add bank — берег";

async function resolveRoom(ctx: BotContext, deps: Deps): Promise<Room | undefined> {
  if (ctx.chat?.type === "private") {
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) await ctx.reply("Сначала создай комнату (/newroom) или вступи по ссылке друга");
    return room;
  }
  const room = ctx.chat ? await findRoomByChat(deps.db, ctx.chat.id) : undefined;
  if (!room) await ctx.reply("Эта группа ещё не привязана к комнате — отправь /link");
  return room;
}

async function askForTranslation(ctx: BotContext, draft: Draft, reason: string): Promise<void> {
  draft.awaitingEdit = true;
  await ctx.reply(`${reason} <b>${esc(draft.term)}</b> — пришли перевод ответом на это сообщение.`, {
    ...HTML,
    reply_markup: { force_reply: true },
  });
}

async function sendPreview(ctx: BotContext, draft: Draft): Promise<void> {
  await ctx.reply(draftText(draft), { ...HTML, reply_markup: draftKeyboard(draft.id) });
}

async function startAdd(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const parsed = parseAddInput(input);
  if (!parsed) return void (await ctx.reply(USAGE));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;
  if (await findWord(deps.db, room.id, parsed.term)) {
    return void (await ctx.reply(`«${esc(parsed.term)}» уже есть в комнате`, HTML));
  }

  await ctx.replyWithChatAction("typing");
  let enrichment: Enrichment | undefined;
  try {
    enrichment = await deps.enricher.enrich(parsed.term, parsed.translation);
  } catch (err) {
    console.error("Enrichment failed", parsed.term, err);
  }

  const draft = deps.drafts.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    term: parsed.term,
    translation: parsed.translation ?? enrichment?.translation ?? "",
    explanation: enrichment?.explanation ?? "",
    example: enrichment?.example ?? "",
  });
  if (!draft.translation) return askForTranslation(ctx, draft, "Не получилось подобрать перевод для");
  await sendPreview(ctx, draft);
}

async function broadcastWord(deps: Deps, word: Word, members: User[], adder: User, currentChatId?: number) {
  const room = await getRoom(deps.db, word.roomId);
  if (!room) return;
  if (room.telegramChatId != null && room.telegramChatId !== currentChatId) {
    await deps.notifier.group(room.telegramChatId, announceText(adder.firstName, word), HTML);
  }
  for (const member of members) {
    if (member.id === adder.id) continue;
    await deps.notifier.dm(member, knowPrompt(adder.firstName, word, room.name), {
      ...HTML,
      reply_markup: knowKeyboard(word.id),
    });
  }
}

export function registerAdd(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("add", (ctx) => startAdd(ctx, deps, ctx.match));

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return next();
    const awaiting = deps.drafts.findAwaiting(ctx.user.id, ctx.chat.id);
    if (awaiting) {
      awaiting.translation = text.trim();
      awaiting.awaitingEdit = false;
      return sendPreview(ctx, awaiting);
    }
    if (ctx.chat.type === "private") return startAdd(ctx, deps, text);
    return next();
  });

  bot.callbackQuery(/^d:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const draft = cb?.k === "draft" ? deps.drafts.get(cb.id) : undefined;
    if (cb?.k !== "draft" || !draft || draft.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Этот черновик уже неактуален" }));
    }
    if (cb.action === "cancel") {
      deps.drafts.delete(draft.id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("❌ Отменено"));
    }
    if (cb.action === "edit") {
      await ctx.answerCallbackQuery();
      return askForTranslation(ctx, draft, "Исправляем перевод для");
    }

    deps.drafts.delete(draft.id);
    const result = await saveWord(deps.db, {
      roomId: draft.roomId,
      addedBy: ctx.user.id,
      draft: { term: draft.term, translation: draft.translation, explanation: draft.explanation, example: draft.example },
      now: deps.now(),
    });
    if (result.status === "duplicate") {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`«${esc(draft.term)}» уже есть в комнате`, HTML));
    }
    await ctx.answerCallbackQuery({ text: "Добавлено!" });
    await ctx.editMessageText(`✅ Добавлено\n\n${draftText(result.word)}`, HTML);
    await broadcastWord(deps, result.word, result.members, ctx.user, ctx.chat?.id);
  });
}
```

- [ ] **Step 2: Подключить в setup.ts**

В `src/bot/setup.ts` добавить импорт и вызов после `registerRooms` (и после будущих `registerLearn`/`registerStats` — `registerAdd` всегда последним из регистраций, т.к. ловит любой текст):
```ts
import { registerAdd } from "./handlers/add";
// ...
  registerRooms(bot, deps);
  registerAdd(bot, deps);
```

- [ ] **Step 3: Typecheck и тесты**

Run: `npm run typecheck && npm test`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка (если есть `.env`; иначе отметить в отчёте)**

1. В личке написать `serendipity` → через несколько секунд черновик с переводом, объяснением, примером и кнопками.
2. ✏️ → бот просит ответить переводом → ответить «удача» → новый черновик с переводом «удача».
3. ✅ → «Добавлено»; второй аккаунт получает «… добавил(а) … Знаешь это слово?»; в привязанной группе появляется объявление.
4. Ещё раз `serendipity` → «уже есть в комнате».
5. В группе `/add bank — берег` → черновик в группе, ✅ нажимает автор — работает; другой участник — «Этот черновик уже неактуален».

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/add.ts src/bot/setup.ts
git commit -m "feat: add-word flow with LLM draft and broadcast"
```

---

### Task 16: Повторение в боте и «знаешь?»

**Files:**
- Create: `src/bot/handlers/learn.ts`
- Modify: `src/bot/setup.ts`

**Interfaces:**
- Consumes: `nextDue`, `getDueItemByCard`, `answerCard`, `markKnown`, `nextReviewAt` (Task 8), `getWord` (Task 7), тексты/клавиатуры (Task 13).
- Produces: `registerLearn(bot: Bot<BotContext>, deps: Deps): void`.

- [ ] **Step 1: Реализация**

`src/bot/handlers/learn.ts`:
```ts
import type { Bot, InlineKeyboard } from "grammy";
import { State } from "ts-fsrs";
import { answerCard, getDueItemByCard, markKnown, nextDue, nextReviewAt } from "../../services/review";
import { getWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { rateKeyboard, showKeyboard } from "../keyboards";
import { cardFront, doneText, draftText } from "../texts";

/** Сколько карточек пользователь ответил в текущей сессии /learn (только для итогового сообщения). */
const sessionCounts = new Map<number, number>();

async function showNext(ctx: BotContext, deps: Deps, mode: "reply" | "edit"): Promise<void> {
  const item = await nextDue(deps.db, ctx.user.id, deps.now());
  let text: string;
  let replyMarkup: InlineKeyboard | undefined;
  if (item) {
    text = cardFront(item.word);
    replyMarkup = showKeyboard(item.card.id, item.card.reps);
  } else {
    const next = await nextReviewAt(deps.db, ctx.user.id);
    text = doneText(sessionCounts.get(ctx.user.id) ?? 0, next, ctx.user.timezone);
    sessionCounts.delete(ctx.user.id);
  }
  const options = { ...HTML, reply_markup: replyMarkup };
  if (mode === "edit") await ctx.editMessageText(text, options);
  else await ctx.reply(text, options);
}

async function startSession(ctx: BotContext, deps: Deps): Promise<void> {
  if (ctx.chat?.type !== "private") {
    return void (await ctx.reply(`Учиться удобнее в личке: https://t.me/${deps.botUsername}`));
  }
  sessionCounts.set(ctx.user.id, 0);
  await showNext(ctx, deps, "reply");
}

export function registerLearn(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("learn", (ctx) => startSession(ctx, deps));

  bot.callbackQuery(/^l$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startSession(ctx, deps);
  });

  bot.callbackQuery(/^s:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const item = cb?.k === "show" ? await getDueItemByCard(deps.db, ctx.user.id, cb.cardId) : undefined;
    if (cb?.k !== "show" || !item || item.card.reps !== cb.reps) {
      return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(draftText(item.word), {
      ...HTML,
      reply_markup: rateKeyboard(item.card.id, item.card.reps, item.card.state === State.New),
    });
  });

  bot.callbackQuery(/^r:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "rate") return void (await ctx.answerCallbackQuery());
    const result = await answerCard(deps.db, {
      userId: ctx.user.id,
      cardId: cb.cardId,
      expectedReps: cb.reps,
      answer: cb.answer,
      now: deps.now(),
    });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery();
    sessionCounts.set(ctx.user.id, (sessionCounts.get(ctx.user.id) ?? 0) + 1);
    await showNext(ctx, deps, "edit");
  });

  bot.callbackQuery(/^k:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "know" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "know" || !word) return void (await ctx.answerCallbackQuery());
    if (!cb.knows) {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`${draftText(word)}\n\n📚 Добавлено в изучение — встретится в /learn`, HTML));
    }
    const result = await markKnown(deps.db, { userId: ctx.user.id, wordId: word.id, now: deps.now() });
    if (result === "stale") return void (await ctx.answerCallbackQuery({ text: "Уже учтено" }));
    await ctx.answerCallbackQuery({ text: "👍" });
    await ctx.editMessageText(`${draftText(word)}\n\n✅ Отмечено как известное — проверю через пару недель`, HTML);
  });
}
```

- [ ] **Step 2: Подключить в setup.ts**

```ts
import { registerLearn } from "./handlers/learn";
// ...
  registerRooms(bot, deps);
  registerLearn(bot, deps);
  registerAdd(bot, deps);
```

- [ ] **Step 3: Typecheck и тесты**

Run: `npm run typecheck && npm test`
Expected: без ошибок.

- [ ] **Step 4: Ручная проверка (если есть `.env`; иначе отметить в отчёте)**

1. Второй аккаунт на «знаешь?» жмёт «Знаю» → сообщение «Отмечено как известное»; повторное нажатие → тост «Уже учтено».
2. `/learn` → слово и «Показать» → перевод и 3 кнопки (+ «Уже знаю» для новых) → «Забыл» → следующая карточка; забытая возвращается в той же сессии.
3. Когда карточек нет → «Готово! Повторено: N» и время следующего повторения.
4. `/learn` в группе → ссылка в личку.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/learn.ts src/bot/setup.ts
git commit -m "feat: learn session and know/don't-know buttons"
```

---

### Task 17: Статистика, настройки, цикл напоминаний, README

**Files:**
- Create: `src/bot/handlers/stats.ts`, `src/reminder-loop.ts`, `README.md`
- Modify: `src/bot/setup.ts`, `src/index.ts`

**Interfaces:**
- Consumes: `personalStats`, `roomLeaderboard` (Task 9), `collectReminders` (Task 10), `parseHHMM` (Task 4), `Notifier` (Task 12), тексты/клавиатуры (Task 13).
- Produces: `registerStats(bot, deps)`; `startReminderLoop(deps: { db: Db; notifier: Notifier; now: () => Date }, intervalMs?: number): () => void`.

- [ ] **Step 1: handlers/stats.ts**

`src/bot/handlers/stats.ts`:
```ts
import type { Bot } from "grammy";
import { getRoom } from "../../services/rooms";
import { personalStats, roomLeaderboard } from "../../services/stats";
import { updateUser } from "../../services/users";
import { parseHHMM } from "../../time";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { hoursKeyboard } from "../keyboards";
import { statsText } from "../texts";

export function registerStats(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("stats", async (ctx) => {
    const now = deps.now();
    const stats = await personalStats(deps.db, ctx.user, now);
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    const board = room ? await roomLeaderboard(deps.db, room.id, now) : undefined;
    await ctx.reply(statsText(stats, room?.name, board), HTML);
  });

  bot.command("settings", async (ctx) => {
    const arg = ctx.match.trim();
    if (arg) {
      const time = parseHHMM(arg);
      if (!time) return void (await ctx.reply("Формат времени: /settings 21:30"));
      await updateUser(deps.db, ctx.user.id, { reminderTime: time });
      return void (await ctx.reply(`⏰ Буду напоминать в ${time}`));
    }
    await ctx.reply(
      `⏰ Сейчас напоминаю в ${ctx.user.reminderTime} (${ctx.user.timezone}).\nВыбери час или отправь /settings ЧЧ:ММ`,
      { reply_markup: hoursKeyboard() },
    );
  });

  bot.callbackQuery(/^t:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "hour") return void (await ctx.answerCallbackQuery());
    const time = `${String(cb.hour).padStart(2, "0")}:00`;
    await updateUser(deps.db, ctx.user.id, { reminderTime: time });
    await ctx.answerCallbackQuery({ text: "Сохранено" });
    await ctx.editMessageText(`⏰ Буду напоминать в ${time}`);
  });
}
```

- [ ] **Step 2: reminder-loop.ts**

`src/reminder-loop.ts`:
```ts
import { learnKeyboard } from "./bot/keyboards";
import { reminderText } from "./bot/texts";
import type { Db } from "./db/client";
import type { Notifier } from "./notifier";
import { collectReminders } from "./services/reminders";

export function startReminderLoop(
  deps: { db: Db; notifier: Notifier; now: () => Date },
  intervalMs = 60_000,
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const { user, dueCount } of await collectReminders(deps.db, deps.now())) {
        await deps.notifier.dm(user, reminderText(dueCount), { reply_markup: learnKeyboard() });
      }
    } catch (err) {
      console.error("Reminder tick failed", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
```

- [ ] **Step 3: Подключить**

`src/bot/setup.ts`:
```ts
import { registerStats } from "./handlers/stats";
// ...
  registerRooms(bot, deps);
  registerLearn(bot, deps);
  registerStats(bot, deps);
  registerAdd(bot, deps);
```

`src/index.ts` — после `setMyCommands`:
```ts
import { startReminderLoop } from "./reminder-loop";
// ...
const stopReminders = startReminderLoop({ db, notifier, now });

const shutdown = () => {
  stopReminders();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
```
(старые строки `process.once(... bot.stop())` удалить.)

- [ ] **Step 4: README.md**

```markdown
# eng-bot

Telegram-бот для совместного заучивания английских слов с друзьями.

## Запуск

1. Node.js ≥ 20.12.
2. Залогиниться в Claude Code на этой машине (`claude`): бот берёт переводы через Claude Agent SDK, API-ключ не нужен.
3. Создать бота у @BotFather, скопировать `.env.example` в `.env` и вписать `BOT_TOKEN`.
   Чтобы бот видел ответы в группах, privacy mode можно оставить включённым — бот работает через команды и ответы на свои сообщения.
4. `npm install`
5. `npm start` (или `caffeinate -i npm start`, чтобы мак не засыпал).

Проверить подсказки отдельно: `npx tsx scripts/try-enrich.ts serendipity`.

## Разработка

- `npm test` — тесты (SQLite in-memory)
- `npm run typecheck`
- `npm run db:generate` — после изменения `src/db/schema.ts`

База лежит в `data/eng-bot.sqlite` (бэкап = копия файла).
```

- [ ] **Step 5: Typecheck и тесты**

Run: `npm run typecheck && npm test`
Expected: без ошибок, все тесты зелёные.

- [ ] **Step 6: Ручная проверка (если есть `.env`; иначе отметить в отчёте)**

1. `/stats` → личные цифры и таблица комнаты.
2. `/settings` → кнопки часов; выбрать текущий час → в течение минуты приходит «🔔 N слов ждут повторения» с кнопкой «Начать», кнопка открывает сессию.
3. Перезапустить бота в тот же день → повторного напоминания нет.

- [ ] **Step 7: Commit**

```bash
git add src/bot/handlers/stats.ts src/bot/setup.ts src/reminder-loop.ts src/index.ts README.md
git commit -m "feat: stats, settings, daily reminders and README"
```
