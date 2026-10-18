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

/** Что проверяем: текст, сообщение в чате (для контекста и ответа) и кто его написал. */
interface CheckTarget {
  text: string;
  chatId: number;
  /** Сообщение чата с этим текстом; нет — текст пришёл в самой команде. */
  message?: { messageId: number; date: number };
  author: { id: number; firstName: string; isBot: boolean };
  /** Пересланное: автор неизвестен, ошибки не записываем. */
  forwarded: boolean;
  /** Кто попросил проверку. */
  callerTgId: number;
  /** На какое сообщение отвечать. */
  replyToId: number;
}

async function checkTarget(ctx: BotContext, deps: Deps, target: CheckTarget): Promise<void> {
  const { text, chatId, message: original, author: authorTg } = target;
  if (text.length > MAX_CHECK_CHARS) {
    return void (await ctx.reply(`Слишком длинный текст для проверки — пришли до ${MAX_CHECK_CHARS} символов за раз`));
  }
  const context = original
    ? deps.history.before(chatId, original, CONTEXT_MESSAGES, CONTEXT_MAX_AGE_SEC).map((m) => ({ author: m.author, text: m.text }))
    : [];

  await ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  let result: CheckResult;
  try {
    const leadIn = original
      ? deps.history.leadIn(chatId, { ...original, authorId: authorTg.id }, LEAD_IN_GAP_SEC).map((m) => m.text)
      : [];
    result = await deps.enricher.check(text, context, authorTg.firstName, leadIn);
  } catch (err) {
    console.error("Check failed", err);
    return void (await ctx.api.sendMessage(chatId, "Не получилось проверить 😔 Попробуй ещё раз чуть позже"));
  }
  const real = result.fixes.filter((f) => !f.slip);
  const author = real.length && !authorTg.isBot && !target.forwarded ? await getUserByTelegramId(deps.db, authorTg.id) : undefined;
  const self = authorTg.id === target.callerTgId;
  const baseText = checkText(result);
  const replyTo = { reply_parameters: { message_id: target.replyToId, allow_sending_without_reply: true } };

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
    return void (await ctx.api.sendMessage(chatId, `${baseText}\n\n${ask}`, { ...HTML, ...replyTo, reply_markup: mistakesAskKeyboard(id) }));
  }
  const note = real.length && !authorTg.isBot && !target.forwarded ? mistakesNotSavedText(authorTg.firstName, deps.botUsername) : "";
  await ctx.api.sendMessage(chatId, note ? `${baseText}\n\n${note}` : baseText, { ...HTML, ...replyTo });
}

async function runCheck(ctx: BotContext, deps: Deps): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const original = message.reply_to_message;
  const own = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const quoted = (original?.text ?? original?.caption ?? "").trim();
  const text = quoted || own;
  if (!text) return void (await ctx.reply(message.chat.type === "private" ? USAGE : GROUP_USAGE));
  // Автор проверяемого текста: автор сообщения, а если текст пришёл в самой команде
  // (/check текст, в том числе ответом на фото) — её отправитель.
  const authorTg = quoted && original?.from ? original.from : message.from;
  await checkTarget(ctx, deps, {
    text,
    chatId: message.chat.id,
    message: original && quoted ? { messageId: original.message_id, date: original.date } : undefined,
    author: { id: authorTg.id, firstName: authorTg.first_name, isBot: authorTg.is_bot },
    forwarded: Boolean(quoted && original?.forward_origin),
    callerTgId: message.from.id,
    replyToId: original?.message_id ?? message.message_id,
  });
}

/** Реакция-триггер: 👀 на сообщение в группе — то же, что /check ответом на него. */
export const CHECK_REACTION = "👀";

async function runReactionCheck(ctx: BotContext, deps: Deps): Promise<void> {
  const reaction = ctx.messageReaction;
  if (!reaction?.user) return;
  const added = reaction.new_reaction.some((r) => r.type === "emoji" && r.emoji === CHECK_REACTION);
  const had = reaction.old_reaction.some((r) => r.type === "emoji" && r.emoji === CHECK_REACTION);
  if (!added || had) return;
  const seen = deps.history.find(reaction.chat.id, reaction.message_id);
  // Текст бот знает только по своей памяти: сообщение старое или было до перезапуска — молчим, чтобы не шуметь.
  if (!seen || seen.authorId === undefined) return;
  await checkTarget(ctx, deps, {
    text: seen.text,
    chatId: reaction.chat.id,
    message: { messageId: seen.messageId, date: seen.date },
    author: { id: seen.authorId, firstName: seen.author, isBot: false },
    forwarded: Boolean(seen.forwarded),
    callerTgId: reaction.user.id,
    replyToId: seen.messageId,
  });
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
      deps.history.record(m.chat.id, {
        messageId: m.message_id,
        authorId: m.from.id,
        author: m.from.first_name,
        text,
        date: m.date,
        forwarded: Boolean(m.forward_origin),
      });
    }
    await next();
  });

  bot.command("check", (ctx) => background(ctx, () => runCheck(ctx, deps)));

  // Реакции приходят боту, только если он админ группы и подписан на message_reaction (см. index.ts).
  bot.on("message_reaction", (ctx) => background(ctx, () => runReactionCheck(ctx, deps)));
}
