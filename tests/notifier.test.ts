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
