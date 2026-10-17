import type { Bot } from "grammy";
import type { Word } from "../../db/schema";
import type { Enrichment } from "../../llm/enricher";
import { isMember } from "../../services/rooms";
import { findWord, getWord, normalizeTerm, parseAddInput, updateWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { PendingEdit } from "../edits";
import { wordActionsKeyboard } from "../keyboards";
import { draftText, esc } from "../texts";
import { clearPendingInputs } from "../pending";
import { pickWord } from "../word-picker";

async function askEdit(ctx: BotContext, deps: Deps, word: Word): Promise<void> {
  if (!ctx.chat) return;
  clearPendingInputs(deps, ctx.user.id);
  deps.edits.set(ctx.user.id, { wordId: word.id, chatId: ctx.chat.id });
  await ctx.reply(
    `✏️ Сейчас:\n\n${draftText(word)}\n\nПришли исправление ответом на это сообщение: новый перевод — или «слово — перевод», если опечатка в самом слове.`,
    { ...HTML, reply_markup: { force_reply: true } },
  );
}

async function applyEdit(ctx: BotContext, deps: Deps, pending: PendingEdit, text: string): Promise<void> {
  const word = await getWord(deps.db, pending.wordId);
  if (!word) return void (await ctx.reply("Это слово уже удалили"));

  const parsed = parseAddInput(text);
  // «слово — перевод» переименовывает слово, только если слева английский; «сдаться — уступить» — это просто перевод.
  const rename = Boolean(parsed?.translation && /[A-Za-z]/.test(parsed.term));
  const term = rename && parsed ? parsed.term : word.term;
  const translation = rename && parsed?.translation ? parsed.translation : text.trim();
  const clash = normalizeTerm(term) !== word.termNormalized ? await findWord(deps.db, word.roomId, term) : undefined;
  if (clash) return void (await ctx.reply(`«${esc(term)}» уже есть в комнате — ничего не менял`, HTML));

  await ctx.replyWithChatAction("typing");
  let enrichment: Enrichment | undefined;
  try {
    enrichment = await deps.enricher.enrich(term, translation);
  } catch (err) {
    console.error("Re-enrichment failed, keeping old explanation", term, err);
  }
  const result = await updateWord(deps.db, word.id, {
    term,
    translation,
    explanation: enrichment?.explanation ?? word.explanation,
    example: enrichment?.example ?? word.example,
    // Если слово переименовали, а Claude не ответил, старая транскрипция уже неверна.
    transcriptionUk: enrichment?.transcriptionUk ?? (term === word.term ? undefined : ""),
    transcriptionUs: enrichment?.transcriptionUs ?? (term === word.term ? undefined : ""),
  });
  if (result.status === "missing") return void (await ctx.reply("Это слово уже удалили"));
  if (result.status === "duplicate") return void (await ctx.reply(`«${esc(term)}» уже есть в комнате — ничего не менял`, HTML));
  await ctx.reply(`✏️ Обновлено\n\n${draftText(result.word)}`, { ...HTML, reply_markup: wordActionsKeyboard(result.word.id) });
}

export function registerEdit(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("edit", (ctx) =>
    background(ctx, () => pickWord(ctx, deps, ctx.match.trim(), "edit", (word) => askEdit(ctx, deps, word))),
  );

  bot.callbackQuery(/^e:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "edit" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (!(await isMember(deps.db, word.roomId, ctx.user.id))) return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    await ctx.answerCallbackQuery();
    await askEdit(ctx, deps, word);
  });

  // Ответ с исправлением. Регистрируется раньше общего обработчика текста из add.ts.
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const pending = deps.edits.get(ctx.user.id);
    if (text.startsWith("/") || !pending || pending.chatId !== ctx.chat.id) return next();
    // В группе бот видит всю переписку, поэтому исправление принимаем только ответом на сообщение бота.
    if (ctx.chat.type !== "private" && ctx.message.reply_to_message?.from?.id !== ctx.me.id) return next();
    deps.edits.delete(ctx.user.id);
    background(ctx, () => applyEdit(ctx, deps, pending, text));
  });
}
