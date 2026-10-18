import type { Bot } from "grammy";
import type { CheckResult } from "../../llm/enricher";
import { background, HTML, type BotContext, type Deps } from "../context";
import { recordMistakes } from "../../services/mistakes";
import { getUserByTelegramId } from "../../services/users";
import { decodeCb } from "../callbacks";
import { mistakesAskKeyboard } from "../keyboards";
import { checkText, mistakesAskText, mistakesNotSavedText, mistakesSavedText } from "../texts";

const USAGE = "Ответь командой /check на сообщение на английском — проверю ошибки.\nИли пришли текст сразу: /check he go to work";
/** Сколько предыдущих сообщений отдавать Claude как контекст и насколько они могут быть старше проверяемого. */
const CONTEXT_MESSAGES = 6;
/** Сообщения автора подряд с такими паузами считаются одной репликой. */
const LEAD_IN_GAP_SEC = 3 * 60;
/** Длиннее — ответ с исправлениями может не влезть в сообщение Telegram. */
const MAX_CHECK_CHARS = 1500;
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
  if (text.length > MAX_CHECK_CHARS) {
    return void (await ctx.reply(`Слишком длинный текст для проверки — пришли до ${MAX_CHECK_CHARS} символов за раз`));
  }
  const context = original
    ? deps.history
        .before(message.chat.id, { messageId: original.message_id, date: original.date }, CONTEXT_MESSAGES, CONTEXT_MAX_AGE_SEC)
        .map((m) => ({ author: m.author, text: m.text }))
    : [];

  // Автор проверяемого текста: автор сообщения, а если текст пришёл в самой команде
  // (/check текст, в том числе ответом на фото) — её отправитель. Пересланное не записываем: автор неизвестен.
  const fromOriginal = Boolean((original?.text ?? original?.caption ?? "").trim());
  const authorTg = fromOriginal && original?.from ? original.from : message.from;
  const forwarded = fromOriginal && Boolean(original?.forward_origin);

  await ctx.replyWithChatAction("typing");
  let result: CheckResult;
  try {
    const leadIn =
      original?.from && fromOriginal
        ? deps.history
            .leadIn(message.chat.id, { messageId: original.message_id, date: original.date, authorId: original.from.id }, LEAD_IN_GAP_SEC)
            .map((m) => m.text)
        : [];
    result = await deps.enricher.check(text, context, authorTg.first_name, leadIn);
  } catch (err) {
    console.error("Check failed", err);
    return void (await ctx.reply("Не получилось проверить 😔 Попробуй ещё раз чуть позже"));
  }
  const real = result.fixes.filter((f) => !f.slip);
  const author = real.length && !authorTg.is_bot && !forwarded ? await getUserByTelegramId(deps.db, authorTg.id) : undefined;
  const self = authorTg.id === message.from.id;
  const baseText = checkText(result);
  const replyTo = { reply_parameters: { message_id: original?.message_id ?? message.message_id, allow_sending_without_reply: true } };

  if (author) {
    // Ничего не сохраняем без явного «✅ Сохранить» — проверка бывает неправа (например, сообщение — продолжение предыдущего).
    const id = deps.pendingMistakes.create({
      authorUserId: author.id,
      authorName: self ? undefined : author.firstName,
      callerUserId: ctx.user.id,
      fixes: real,
      baseText,
    });
    const ask = mistakesAskText(self ? undefined : author.firstName, real.map((f) => f.category ?? ""));
    return void (await ctx.reply(`${baseText}\n\n${ask}`, { ...HTML, ...replyTo, reply_markup: mistakesAskKeyboard(id) }));
  }
  const note = real.length && !authorTg.is_bot && !forwarded ? mistakesNotSavedText(authorTg.first_name, deps.botUsername) : "";
  await ctx.reply(note ? `${baseText}\n\n${note}` : baseText, { ...HTML, ...replyTo });
}

export function registerCheck(bot: Bot<BotContext>, deps: Deps): void {
  bot.callbackQuery(/^mk:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const pending = cb?.k === "mistakesSave" ? deps.pendingMistakes.peek(cb.id) : undefined;
    if (cb?.k !== "mistakesSave" || !pending) return void (await ctx.answerCallbackQuery({ text: "Это уже неактуально" }));
    if (ctx.user.id !== pending.authorUserId && ctx.user.id !== pending.callerUserId) {
      return void (await ctx.answerCallbackQuery({ text: "Решить может автор сообщения или тот, кто проверял" }));
    }
    deps.pendingMistakes.take(cb.id);
    if (cb.save) await recordMistakes(deps.db, pending.authorUserId, pending.fixes, deps.now());
    const outcome = cb.save
      ? mistakesSavedText(pending.authorName, pending.fixes.map((f) => f.category ?? ""))
      : "✖️ Ошибки не сохранены";
    await ctx.answerCallbackQuery({ text: cb.save ? "Сохранено" : "Не сохраняю" });
    await ctx.editMessageText(`${pending.baseText}\n\n${outcome}`, HTML);
  });

  // Запоминаем обычные сообщения групп (не команды), чтобы потом дать /check контекст.
  bot.on("message", async (ctx, next) => {
    const m = ctx.message;
    const text = m.text ?? m.caption;
    if (m.chat.type !== "private" && text && !text.startsWith("/")) {
      deps.history.record(m.chat.id, { messageId: m.message_id, authorId: m.from.id, author: m.from.first_name, text, date: m.date });
    }
    await next();
  });

  bot.command("check", (ctx) => background(ctx, () => runCheck(ctx, deps)));
}
