import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { eq } from "drizzle-orm";
import type { Update } from "grammy/types";
import { cards } from "../src/db/schema";
import { cardData, LEARN_WIDGET_HTML, WIDGET_DATA_LIMIT } from "../src/bot/handlers/learn-widget";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

async function setup(h: ReturnType<typeof botHarness>) {
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const term of ["beset by", "reluctant"]) {
    const r = await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `перевод ${term}`, explanation: "", example: "" }, now: T0 });
    if (r.status !== "saved") throw new Error("dup");
  }
}

const widgetQuery = (data: string): Update =>
  ({
    update_id: 9000,
    widget_query: { id: "q1", from: { id: 100, is_bot: false, first_name: "User100" }, chat: { id: 100, type: "private" }, message_id: 7, chat_instance: "x", data },
  }) as unknown as Update;

const shown = (h: ReturnType<typeof botHarness>) => {
  const last = h.calls.filter((c) => c.method === "sendWidget" || c.method === "editMessageWidgetData").at(-1)!;
  return JSON.parse(String(last.payload.chat_data));
};

describe("/learnnew widget", () => {
  it("fits Telegram's widget size limits", () => {
    expect(Buffer.byteLength(LEARN_WIDGET_HTML)).toBeLessThanOrEqual(32768);
    expect(deflateSync(LEARN_WIDGET_HTML, { level: 9 }).length).toBeLessThanOrEqual(4096);
  });

  it("is admin-only", async () => {
    const h = botHarness({ adminTelegramId: 1 });
    await setup(h);
    await h.bot.handleUpdate(h.message(100, "/learnnew"));
    expect(h.calls.some((c) => c.method === "sendWidget")).toBe(false);
  });

  it("sends the first card, records a tap and shows the next card in the same message", async () => {
    const h = botHarness({ adminTelegramId: 100 });
    await setup(h);
    await h.bot.handleUpdate(h.message(100, "/learnnew"));
    const first = shown(h);
    expect(first.new).toBe(1);

    await h.bot.handleUpdate(widgetQuery(`${first.c}:${first.r}:good:0`));
    const [card] = await h.db.select().from(cards).where(eq(cards.id, first.c));
    expect(card!.reps).toBe(first.r + 1);
    const edit = h.calls.find((c) => c.method === "editMessageWidgetData")!;
    expect(edit.payload).toMatchObject({ chat_id: 100, message_id: 7 });
    const second = shown(h);
    expect(second.c).not.toBe(first.c);
    expect(second.n).toBe(1);
    expect(h.calls.at(-1)).toMatchObject({ method: "answerWidgetQuery", payload: { widget_query_id: "q1" } });
  });

  it("answers the query even for junk data", async () => {
    const h = botHarness({ adminTelegramId: 100 });
    await setup(h);
    await h.bot.handleUpdate(widgetQuery("hello"));
    expect(h.calls.map((c) => c.method)).toEqual(["answerWidgetQuery"]);
  });

  it("keeps card data within the limit", () => {
    const item = { card: { id: 1, reps: 0, state: 0 }, word: { term: "x", translation: "я".repeat(2000), example: "e".repeat(2000), transcriptionUk: "", transcriptionUs: "" } };
    const data = cardData(item as never, 3);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(WIDGET_DATA_LIMIT);
    expect(JSON.parse(data)).toMatchObject({ e: "", n: 3 });
  });
});
