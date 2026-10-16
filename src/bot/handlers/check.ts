import type { Bot } from "grammy";
import type { CheckResult } from "../../llm/enricher";
import { background, HTML, type BotContext, type Deps } from "../context";
import { recordMistakes } from "../../services/mistakes";
import { getUserByTelegramId } from "../../services/users";
import { checkText, mistakesNotSavedText, mistakesSavedText } from "../texts";

const USAGE = "Ответь командой /check на сообщение на английском — проверю ошибки.\nИли пришли текст сразу: /check he go to work";
/** Сколько предыдущих сообщений отдавать Claude как контекст и насколько они могут быть старше проверяемого. */
const CONTEXT_MESSAGES = 3;
const CONTEXT_MAX_AGE_SEC = 15 * 60;

const GROUP_USAGE = [
  "Ответь командой /check на сообщение на английском — проверю ошибки.",
  "Если ты уже ответил, значит, это сообщение я не вижу: оно отправлено до того, как меня добавили в группу",
  "(или пока у меня был включён режим конфиденциальности). Такие можно проверить так: /check текст",
].join("\n");

async function runCheck(ctx: BotContext, deps: Deps): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const original = message.reply_to_message;
  const text = (original?.text ?? original?.caption ?? "").trim() || (typeof ctx.match === "string" ? ctx.match.trim() : "");
  if (!text) return void (await ctx.reply(message.chat.type === "private" ? USAGE : GROUP_USAGE));
  const context = original
    ? deps.history
        .before(message.chat.id, { messageId: original.message_id, date: original.date }, CONTEXT_MESSAGES, CONTEXT_MAX_AGE_SEC)
        .map((m) => ({ author: m.author, text: m.text }))
    : [];

  await ctx.replyWithChatAction("typing");
  let result: CheckResult;
  try {
    result = await deps.enricher.check(text, context);
  } catch (err) {
    console.error("Check failed", err);
    return void (await ctx.reply("Не получилось проверить 😔 Попробуй ещё раз чуть позже"));
  }
  // Ошибки записываем тому, кто их совершил: автору сообщения, а при /check текст — отправителю команды.
  const authorTg = original?.from ?? message.from;
  const real = result.fixes.filter((f) => !f.slip);
  const author = real.length && !authorTg.is_bot ? await getUserByTelegramId(deps.db, authorTg.id) : undefined;
  if (author) await recordMistakes(deps.db, author.id, real, deps.now());
  const self = authorTg.id === message.from.id;
  const note = !real.length || authorTg.is_bot
    ? ""
    : author
      ? mistakesSavedText(self ? undefined : author.firstName, real.map((f) => f.category ?? ""))
      : mistakesNotSavedText(authorTg.first_name, deps.botUsername);
  await ctx.reply(note ? `${checkText(result)}\n\n${note}` : checkText(result), {
    ...HTML,
    reply_parameters: { message_id: original?.message_id ?? message.message_id, allow_sending_without_reply: true },
  });
}

export function registerCheck(bot: Bot<BotContext>, deps: Deps): void {
  // Запоминаем обычные сообщения групп (не команды), чтобы потом дать /check контекст.
  bot.on("message", async (ctx, next) => {
    const m = ctx.message;
    const text = m.text ?? m.caption;
    if (m.chat.type !== "private" && text && !text.startsWith("/")) {
      deps.history.record(m.chat.id, { messageId: m.message_id, author: m.from.first_name, text, date: m.date });
    }
    await next();
  });

  bot.command("check", (ctx) => background(ctx, () => runCheck(ctx, deps)));
}
