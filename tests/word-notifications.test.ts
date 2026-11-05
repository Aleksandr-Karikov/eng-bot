import { describe, expect, it } from "vitest";
import { broadcastBatch, broadcastWord } from "../src/bot/word-flow";
import { createRoom, joinRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("new words in a room with a linked group", () => {
  it("notifies other members privately without posting a separate group announcement", async () => {
    const h = botHarness();
    const author = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const friend = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: author.id, now: T0, telegramChatId: -500 });
    await joinRoom(h.db, { roomId: room.id, userId: friend.id, now: T0, makeCurrent: true });
    const result = await saveWord(h.db, { roomId: room.id, addedBy: author.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
    if (result.status !== "saved") throw new Error("Word not saved");

    await broadcastWord(h.deps, result.word, result.members, author);
    await broadcastBatch(h.deps, room.id, [result.word], author);

    const chats = h.calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.chat_id);
    expect(chats).toEqual([200, 200]);
  });
});
