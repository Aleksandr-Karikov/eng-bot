import { describe, expect, it, vi } from "vitest";
import type { CheckResult } from "../src/llm/enricher";
import { buildCheckPrompt } from "../src/llm/enricher";
import { ChatHistory } from "../src/bot/history";
import { recentMistakes } from "../src/services/mistakes";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const result: CheckResult = {
  corrected: "a book **by** a YouTuber",
  fixes: [
    { wrong: "of", right: "by", why: "book by", category: "предлоги" },
    { wrong: "youtuber", right: "a YouTuber", why: "артикль", category: "артикли" },
  ],
  natural: "",
};

function harness() {
  const check = vi.fn(async () => result);
  const h = botHarness({ enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], check } });
  return { h, check };
}

const texts = (h: ReturnType<typeof botHarness>) => h.calls.map((c) => String(c.payload.text ?? ""));

async function checkArtemsMessage(h: ReturnType<typeof botHarness>) {
  await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/check", { messageId: 5, fromId: 200, text: "a book of good youtuber" }));
  await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Сохранить")).not.toThrow());
}

describe("/check asks before saving mistakes", () => {
  it("saves nothing until confirmed, then saves for the author", async () => {
    const { h } = harness();
    await makeUser(h.db, 100);
    const artem = await makeUser(h.db, 200, "Артём");
    await checkArtemsMessage(h);
    expect(await recentMistakes(h.db, artem.id, T0)).toHaveLength(0);
    expect(texts(h).some((t) => t.includes("Сохранить ошибки") && t.includes("предлоги, артикли"))).toBe(true);

    await h.bot.handleUpdate(h.groupCallback(100, -500, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, artem.id, T0)).toHaveLength(2);
    expect(texts(h).some((t) => t.includes("🧠 Сохранено"))).toBe(true);
  });

  it("the author can confirm too, and «Не сохранять» drops them", async () => {
    const a = harness();
    await makeUser(a.h.db, 100);
    const artem = await makeUser(a.h.db, 200);
    await checkArtemsMessage(a.h);
    await a.h.bot.handleUpdate(a.h.groupCallback(200, -500, buttonData(a.h.calls, "✅ Сохранить")));
    expect(await recentMistakes(a.h.db, artem.id, T0)).toHaveLength(2);

    const b = harness();
    await makeUser(b.h.db, 100);
    const artem2 = await makeUser(b.h.db, 200);
    await checkArtemsMessage(b.h);
    await b.h.bot.handleUpdate(b.h.groupCallback(100, -500, buttonData(b.h.calls, "✖️ Не сохранять")));
    await b.h.bot.handleUpdate(b.h.groupCallback(100, -500, buttonData(b.h.calls, "✅ Сохранить")));
    expect(await recentMistakes(b.h.db, artem2.id, T0)).toHaveLength(0);
  });

  it("someone else cannot confirm", async () => {
    const { h } = harness();
    await makeUser(h.db, 100);
    const artem = await makeUser(h.db, 200);
    await makeUser(h.db, 300);
    await checkArtemsMessage(h);
    await h.bot.handleUpdate(h.groupCallback(300, -500, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, artem.id, T0)).toHaveLength(0);
    const answer = h.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!;
    expect(String(answer.payload.text)).toContain("автор");
  });
});

describe("messages split into parts", () => {
  it("tells Claude who wrote the checked message and to read continuations as one thought", () => {
    const p = buildCheckPrompt("Which you sent", [{ author: "Артём", text: "But it is a book of good youtuber" }], "Артём");
    expect(p).toContain("Проверяемое сообщение написал(а): Артём");
    expect(p).toMatch(/продолжает предыдущее сообщение того же автора/);
  });

  it("joins the author's directly preceding messages into one remark (no other author between, short pauses)", () => {
    const history = new ChatHistory();
    const msg = (messageId: number, authorId: number, text: string, date: number) => ({ messageId, authorId, author: `u${authorId}`, text, date });
    history.record(-1, msg(1, 200, "Earlier, long ago", 0));
    history.record(-1, msg(2, 100, "Have you already read?", 1000));
    history.record(-1, msg(3, 200, "Nope", 1010));
    history.record(-1, msg(4, 200, "But it is a book of good youtuber", 1020));
    expect(history.leadIn(-1, { messageId: 5, date: 1030, authorId: 200 }, 180).map((m) => m.text)).toEqual([
      "Nope",
      "But it is a book of good youtuber",
    ]);
    expect(history.leadIn(-1, { messageId: 5, date: 1500, authorId: 200 }, 180)).toEqual([]);
  });

  it("passes the joined remark to Claude", async () => {
    const { h, check } = harness();
    await makeUser(h.db, 100);
    await makeUser(h.db, 200);
    await h.bot.handleUpdate(h.groupMessage(200, -500, "But it is a book of good youtuber"));
    const target = h.groupMessage(200, -500, "Which you sent");
    await h.bot.handleUpdate(target);
    await h.bot.handleUpdate(h.groupReplyTo(100, -500, "/check", { messageId: target.message!.message_id, fromId: 200, text: "Which you sent" }));
    await vi.waitFor(() => expect(check).toHaveBeenCalled());
    expect(check).toHaveBeenCalledWith("Which you sent", expect.any(Array), "User200", ["But it is a book of good youtuber"]);
    expect(buildCheckPrompt("Which you sent", [], "Артём", ["But it is a book"])).toContain("«But it is a book Which you sent»");
  });
});
