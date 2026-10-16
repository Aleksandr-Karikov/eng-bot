import { describe, expect, it, vi } from "vitest";
import { knowPrompt } from "../src/bot/texts";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("answers under a spoiler", () => {
  it("/learn shows the word with the answer hidden and rating buttons right away", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "край реки", example: "the river bank" }, now: T0 });

    await h.bot.handleUpdate(h.message(100, "/learn"));
    const card = h.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(card.payload.text)).toMatch(/^<b>bank<\/b>/);
    expect(String(card.payload.text)).toContain("<tg-spoiler>берег");
    expect(String(card.payload.text)).toContain("край реки");
    const labels = lastButtons(h.calls).map((b) => b.text);
    expect(labels).toContain("😎 Помню");
    expect(labels).toContain("✅ Уже знаю");
    expect(labels).not.toContain("👀 Показать");
    expect(labels).toContain("😵 Забыл");
    expect(labels).not.toContain("😐 С трудом");
  });

  it("«знаешь?» carries the translation under a spoiler", () => {
    const text = knowPrompt("Саша", { term: "bank", translation: "R&D берег" } as never, "R");
    expect(text).toContain("<tg-spoiler>R&amp;D берег</tg-spoiler>");
  });
});
