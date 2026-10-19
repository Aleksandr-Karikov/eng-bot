import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { cards, words } from "../src/db/schema";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

async function setup() {
  const h = botHarness();
  const me = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const friend = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: friend.id, now: T0 });
  await joinRoom(h.db, { roomId: room.id, userId: me.id, now: T0, makeCurrent: true });
  for (const term of ["arse", "bank"]) {
    await saveWord(h.db, { roomId: room.id, addedBy: friend.id, draft: { term, translation: `t-${term}`, explanation: "", example: "" }, now: T0 });
  }
  return { h, me, friend };
}

const myCards = async (h: ReturnType<typeof botHarness>, userId: number) =>
  (await h.db.select({ term: words.term }).from(cards).innerJoin(words, eq(cards.wordId, words.id)).where(eq(cards.userId, userId))).map((r) => r.term);

describe("🙈 not for me", () => {
  it("from «знаешь?» removes the word only for me, and «↩️ Вернуть» brings it back", async () => {
    const { h, me, friend } = await setup();
    await h.bot.handleUpdate(h.callback(100, "nf:1:k"));
    expect(await myCards(h, me.id)).toEqual(["bank"]);
    expect(await myCards(h, friend.id)).toEqual(["arse", "bank"]);
    expect(String(h.calls.at(-1)?.payload.text)).toContain("у остальных осталось");
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "↩️ Вернуть")));
    expect((await myCards(h, me.id)).sort()).toEqual(["arse", "bank"]);
  });

  it("from a /learn card moves on to the next card", async () => {
    const { h, me } = await setup();
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text)).toContain("arse");
    await h.bot.handleUpdate(h.manage(100));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🙈 Убрать только у меня")));
    expect(await myCards(h, me.id)).toEqual(["bank"]);
    expect(String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text)).toContain("bank");
  });
});
