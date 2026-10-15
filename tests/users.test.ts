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
