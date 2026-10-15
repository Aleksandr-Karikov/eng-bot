import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cards } from "../src/db/schema";
import type { Enrichment } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, settle } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const TOO_OLD = "Bad Request: query is too old and response timeout expired or query ID is invalid";
const NOT_MODIFIED = "Bad Request: message is not modified: specified new message content and reply markup are exactly the same";

async function userWithWord(h: ReturnType<typeof botHarness>) {
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  const [card] = await h.db.select().from(cards).where(eq(cards.userId, user.id));
  return { user, card };
}

describe("bot flows", () => {
  it("a late rating tap still advances the learn session", async () => {
    const h = botHarness({ fail: (c) => (c.method === "answerCallbackQuery" ? TOO_OLD : undefined) });
    const { card } = await userWithWord(h);
    await expect(h.bot.handleUpdate(h.callback(100, `r:${card.id}:0:g`))).resolves.toBeUndefined();
    expect(h.calls.some((c) => c.method === "editMessageText")).toBe(true);
  });

  it("pressing «Показать» twice does not surface an error", async () => {
    let edits = 0;
    const h = botHarness({ fail: (c) => (c.method === "editMessageText" && ++edits > 1 ? NOT_MODIFIED : undefined) });
    const { card } = await userWithWord(h);
    await h.bot.handleUpdate(h.callback(100, `s:${card.id}:0`));
    await expect(h.bot.handleUpdate(h.callback(100, `s:${card.id}:0`))).resolves.toBeUndefined();
  });

  it("/add does not block the update while the LLM is thinking", async () => {
    let release!: (e: Enrichment) => void;
    const h = botHarness({ enricher: { enrich: () => new Promise<Enrichment>((resolve) => (release = resolve)), extract: async () => [] } });
    await userWithWord(h);
    const outcome = await Promise.race([
      h.bot.handleUpdate(h.message(100, "/add serendipity")).then(() => "handled"),
      settle(300).then(() => "blocked"),
    ]);
    expect(outcome).toBe("handled");
    release({ translation: "счастливая случайность", explanation: "", example: "" });
    await vi.waitFor(() =>
      expect(h.calls.some((c) => c.method === "sendMessage" && String(c.payload.text).includes("счастливая случайность"))).toBe(true),
    );
  });
});
