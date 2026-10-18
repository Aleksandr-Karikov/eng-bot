import type { Bot } from "grammy";
import { findRoomByChat } from "../../services/rooms";
import { recordWordUses } from "../../services/word-uses";
import type { BotContext, Deps } from "../context";

/** Кто-то в группе сам употребил слово из словаря комнаты — 👏 и в недельный итог. */
export function registerSpotted(bot: Bot<BotContext>, deps: Deps): void {
  bot.on("message", async (ctx, next) => {
    const m = ctx.message;
    const text = m.text ?? m.caption;
    if (m.chat.type !== "private" && text && !text.startsWith("/") && !m.forward_origin) {
      const room = await findRoomByChat(deps.db, m.chat.id);
      if (room) {
        const used = await recordWordUses(deps.db, { roomId: room.id, userId: ctx.user.id, text, now: deps.now() });
        // В группе могут быть выключены реакции — тогда просто молча считаем.
        if (used.length) await ctx.react("👏").catch((err) => console.error("Reaction failed", m.chat.id, err));
      }
    }
    await next();
  });
}
