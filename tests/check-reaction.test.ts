import { describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import type { CheckResult } from "../src/llm/enricher";
import { recentMistakes } from "../src/services/mistakes";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const result: CheckResult = { corrected: "a book **by** a YouTuber", fixes: [{ wrong: "of", right: "by", why: "book by", category: "предлоги" }], natural: "" };

const reaction = (userId: number, chatId: number, messageId: number, emoji: string, old: string[] = []): Update =>
  ({
    update_id: Math.floor(Math.random() * 1e6),
    message_reaction: {
      chat: { id: chatId, type: "group", title: "G" },
      message_id: messageId,
      user: { id: userId, is_bot: false, first_name: `User${userId}` },
      date: 0,
      old_reaction: old.map((e) => ({ type: "emoji", emoji: e })),
      new_reaction: [...old, emoji].map((e) => ({ type: "emoji", emoji: e })),
    },
  }) as unknown as Update;

function harness() {
  const check = vi.fn(async (_text: string, _context?: unknown, _author?: string, _leadIn?: string[]) => result);
  const h = botHarness({ enricher: { enrich: async () => ({ translation: "", explanation: "", example: "" }), extract: async () => [], extractImage: async () => [], check } });
  return { h, check };
}

describe("👀 on a group message works like /check", () => {
  it("checks the message, replies to it and asks to save the author's mistakes", async () => {
    const { h, check } = harness();
    await makeUser(h.db, 100);
    const artem = await makeUser(h.db, 200, "Артём");
    await h.bot.handleUpdate(h.groupMessage(200, -500, "Have you read it?"));
    const target = h.groupMessage(200, -500, "a book of good youtuber");
    await h.bot.handleUpdate(target);
    await h.bot.handleUpdate(reaction(100, -500, target.message!.message_id, "👀"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Сохранить")).not.toThrow());
    // Предыдущее сообщение того же автора — начало реплики.
    expect(check).toHaveBeenCalledWith("a book of good youtuber", expect.any(Array), "User200", ["Have you read it?"]);
    const answer = h.calls.find((c) => c.method === "sendMessage" && String(c.payload.text).includes("Исправлено"))!;
    expect(answer.payload.chat_id).toBe(-500);
    expect(answer.payload.reply_parameters).toMatchObject({ message_id: target.message!.message_id });
    await h.bot.handleUpdate(h.groupCallback(200, -500, buttonData(h.calls, "✅ Сохранить")));
    expect(await recentMistakes(h.db, artem.id, T0)).toHaveLength(1);
  });

  it("ignores other emoji and a 👀 that was already there; on a message it hasn't seen it says how to check it", async () => {
    const { h, check } = harness();
    await makeUser(h.db, 100);
    const target = h.groupMessage(200, -500, "a book of good youtuber");
    await h.bot.handleUpdate(target);
    await h.bot.handleUpdate(reaction(100, -500, target.message!.message_id, "👍"));
    await h.bot.handleUpdate(reaction(100, -500, target.message!.message_id, "🔥", ["👀"]));
    await h.bot.handleUpdate(reaction(100, -500, 9999, "👀"));
    await new Promise((r) => setTimeout(r, 20));
    expect(check).not.toHaveBeenCalled();
    // На незнакомое сообщение бот не молчит, а говорит, как его проверить — и только на него.
    const hints = h.calls.filter((c) => c.method === "sendMessage" && String(c.payload.text).includes("не помню"));
    expect(hints).toHaveLength(1);
    expect(hints[0].payload.reply_parameters).toMatchObject({ message_id: 9999 });
  });
});
