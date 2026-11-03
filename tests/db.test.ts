import { sql } from "drizzle-orm";
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

// По умолчанию озвучка включена, и это должно быть так и на чистой базе: DEFAULT задаёт миграция,
// а не только схема. Разъехавшись, они дают выключенную озвучку у всех новых пользователей.
it("migration gives voice_accent the same default as the schema", async () => {
  const db = testDb();
  const [{ sql: ddl }] = (await db.all(sql`select sql from sqlite_master where name = 'users'`)) as { sql: string }[];
  expect(ddl).toContain("`voice_accent` text DEFAULT 'uk' NOT NULL");
  await db.run(sql`insert into users (telegram_id, first_name, created_at) values (99, 'X', 1)`);
  const [inserted] = (await db.all(sql`select voice_accent from users where telegram_id = 99`)) as { voice_accent: string }[];
  expect(inserted).toEqual({ voice_accent: "uk" });
});
