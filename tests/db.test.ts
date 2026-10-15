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
