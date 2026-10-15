import type { Bot } from "grammy";
import type { CheckResult } from "../../llm/enricher";
import { background, HTML, type BotContext, type Deps } from "../context";
import { checkText } from "../texts";

const USAGE = "Ответь командой /check на сообщение на английском — проверю ошибки.\nИли пришли текст сразу: /check he go to work";

async function runCheck(ctx: BotContext, deps: Deps): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const original = message.reply_to_message;
  const text = (original?.text ?? original?.caption ?? "").trim() || (typeof ctx.match === "string" ? ctx.match.trim() : "");
  if (!text) return void (await ctx.reply(USAGE));

  await ctx.replyWithChatAction("typing");
  let result: CheckResult;
  try {
    result = await deps.enricher.check(text);
  } catch (err) {
    console.error("Check failed", err);
    return void (await ctx.reply("Не получилось проверить 😔 Попробуй ещё раз чуть позже"));
  }
  await ctx.reply(checkText(result), {
    ...HTML,
    reply_parameters: { message_id: original?.message_id ?? message.message_id, allow_sending_without_reply: true },
  });
}

export function registerCheck(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("check", (ctx) => background(ctx, () => runCheck(ctx, deps)));
}
