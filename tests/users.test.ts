import { describe, expect, it } from "vitest";
import { adoptDeviceTimeZone, getUser, updateUser, upsertUser } from "../src/services/users";
import { createRoom, getRoom, joinRoom, updateRoomTimezone } from "../src/services/rooms";
import { T0, makeUser, testDb } from "./helpers";
import { botHarness } from "./bot-harness";

describe("users", () => {
  it("creates a user once and refreshes the name", async () => {
    const db = testDb();
    const a = await upsertUser(db, { id: 42, first_name: "Саша" }, T0);
    const b = await upsertUser(db, { id: 42, first_name: "Александр", username: "sasha" }, T0);
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ firstName: "Александр", username: "sasha", telegramId: 42 });
  });

  it("gives new users the Novosibirsk timezone", async () => {
    const db = testDb();
    expect((await upsertUser(db, { id: 5, first_name: "N" }, T0)).timezone).toBe("Asia/Novosibirsk");
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

// Пояс при регистрации угадан (Telegram его не отдаёт), а настоящий знает только приложение.
describe("timezone from the device", () => {
  it("replaces the guessed zone with the device one", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    // До приложения — догадка.
    expect(u.timezone).toBe("Asia/Novosibirsk");
    await adoptDeviceTimeZone(db, u.id, "Europe/Moscow");
    expect((await getUser(db, u.id))?.timezone).toBe("Europe/Moscow");
  });

  it("ignores garbage and offset-only zones", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    for (const bad of ["", "Nowhere/Bad", "+07:00", "xyz"]) {
      await adoptDeviceTimeZone(db, u.id, bad);
      // Пояс не сломан: неизвестное значение не записали.
      expect((await getUser(db, u.id))?.timezone).toBe("Asia/Novosibirsk");
    }
  });

  it("keeps adopting the device zone when the phone moves", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    await adoptDeviceTimeZone(db, u.id, "Europe/Moscow");
    // Человек переехал — телефон сообщает новый пояс, и он должен примениться.
    await adoptDeviceTimeZone(db, u.id, "Asia/Seoul");
    expect((await getUser(db, u.id))?.timezone).toBe("Asia/Seoul");
  });
});

// Комнаты, созданные до появления настоящего пояса, не должны навсегда остаться на догадке:
// вместе с поясом автора двигается и пояс его комнат.
describe("room zone follows its author's real zone", () => {
  it("moves the rooms the author created when the device reports a zone", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    const room = await createRoom(db, { name: "R", createdBy: u.id, now: T0 });
    // При создании пояс — догадка.
    expect(room.timezone).toBe("Asia/Novosibirsk");
    await adoptDeviceTimeZone(db, u.id, "Europe/Moscow");
    expect((await getRoom(db, room.id))?.timezone).toBe("Europe/Moscow");
  });

  it("leaves a room whose zone was already set apart", async () => {
    const db = testDb();
    const u = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    const room = await createRoom(db, { name: "R", createdBy: u.id, now: T0 });
    // Кто-то поставил комнате свой пояс — он больше не равен поясу автора, и трогать его нельзя.
    await updateRoomTimezone(db, room.id, "Asia/Seoul");
    await adoptDeviceTimeZone(db, u.id, "Europe/Moscow");
    expect((await getRoom(db, room.id))?.timezone).toBe("Asia/Seoul");
  });

  it("does not touch rooms the person only joined", async () => {
    const db = testDb();
    const author = await upsertUser(db, { id: 1, first_name: "A" }, T0);
    const guest = await upsertUser(db, { id: 2, first_name: "B" }, T0);
    const room = await createRoom(db, { name: "R", createdBy: author.id, now: T0 });
    await joinRoom(db, { roomId: room.id, userId: guest.id, now: T0, makeCurrent: true });
    await adoptDeviceTimeZone(db, guest.id, "Europe/Moscow");
    // Комната чужая: её неделя — дело автора, а не гостя.
    expect((await getRoom(db, room.id))?.timezone).toBe("Asia/Novosibirsk");
  });
});

// /roomtz — ручная смена пояса комнаты. Нужна, потому что автоматика (пояс автора и телефон) может ошибиться.
describe("/roomtz", () => {
  it("shows the room zone and lets the author change it", async () => {
    const h = botHarness();
    const alice = await makeUser(h.db, 1, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.bot.handleUpdate(h.message(1, "/roomtz"));
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Asia/Novosibirsk");
    await h.bot.handleUpdate(h.message(1, "/roomtz Europe/Moscow"));
    expect((await getRoom(h.db, room.id))?.timezone).toBe("Europe/Moscow");
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Europe/Moscow");
  });

  it("rejects an unknown zone instead of breaking the week", async () => {
    const h = botHarness();
    const alice = await makeUser(h.db, 1, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.bot.handleUpdate(h.message(1, "/roomtz Nowhere/Bad"));
    // Пояс не изменился: неизвестное значение сделало бы неделю невычислимой.
    expect((await getRoom(h.db, room.id))?.timezone).toBe("Asia/Novosibirsk");
    expect(String(h.calls.at(-1)?.payload.text)).toContain("Такого пояса не знаю");
  });

  it("takes the person's own zone with 'auto'", async () => {
    const h = botHarness();
    const alice = await updateUser(h.db, (await makeUser(h.db, 1, "Alice")).id, { timezone: "Asia/Seoul" });
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await updateUser(h.db, alice.id, { currentRoomId: room.id });
    await h.bot.handleUpdate(h.message(1, "/roomtz auto"));
    expect((await getRoom(h.db, room.id))?.timezone).toBe("Asia/Seoul");
  });

  it("refuses a guest who did not create the room", async () => {
    const h = botHarness();
    const alice = await makeUser(h.db, 1, "Alice");
    const bob = await makeUser(h.db, 2, "Bob");
    const room = await createRoom(h.db, { name: "R", createdBy: alice.id, now: T0 });
    await joinRoom(h.db, { roomId: room.id, userId: bob.id, now: T0, makeCurrent: true });
    await h.bot.handleUpdate(h.message(2, "/roomtz Europe/Moscow"));
    // Чужую неделю гость не двигает — это решение автора.
    expect((await getRoom(h.db, room.id))?.timezone).toBe("Asia/Novosibirsk");
    expect(String(h.calls.at(-1)?.payload.text)).toContain("меняет её автор");
  });
});
