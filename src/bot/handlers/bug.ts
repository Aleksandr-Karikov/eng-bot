import type { Bot } from "grammy";
import { saveBug } from "../../services/bugs";
import { recentLogs } from "../../log-buffer";
import { HTML, type BotContext, type Deps } from "../context";

const USAGE = "Напиши после команды, что пошло не так. Например: /bug кнопка «Дальше» не нажимается\nМожно ответом на сообщение бота — оно сохранится как главное.";
const MAX_DESCRIPTION = 2000;

export function registerBug(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("bug", async (ctx) => {
    const description = ctx.match.trim().slice(0, MAX_DESCRIPTION);
    const replied = ctx.message?.reply_to_message;
    const repliedText = replied ? (replied.text ?? replied.caption ?? "").trim() : "";
    if (!description && !repliedText) return void (await ctx.reply(USAGE));
    // Сама команда /bug уже в переписке — убираем её, она есть в описании.
    const transcript = deps.transcript.recent(ctx.chat.id).filter((e) => !(e.from === "user" && e.text.startsWith("/bug")));
    const id = await saveBug(deps.db, {
      userId: ctx.user.id,
      chatId: ctx.chat.id,
      description: description || "(без описания — см. сообщение, на которое ответили)",
      context: { replied: repliedText || undefined, transcript, logs: recentLogs() },
      now: deps.now(),
    });
    await ctx.reply(`🐞 Записал, баг #${id}. Спасибо — разберёмся!`, {
      ...HTML,
      reply_parameters: { message_id: ctx.message?.message_id ?? 0, allow_sending_without_reply: true },
    });
  });
}
