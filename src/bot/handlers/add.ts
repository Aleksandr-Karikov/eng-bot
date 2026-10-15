import type { Bot } from "grammy";
import type { Enrichment } from "../../llm/enricher";
import { findWord, parseAddInput, saveWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { wordActionsKeyboard } from "../keyboards";
import { draftText, esc } from "../texts";
import { askForTranslation, broadcastWord, resolveRoom, sendPreview } from "../word-flow";
import { onBatchDraft } from "./batch";

const USAGE = "Напиши слово после команды: /add serendipity\nМожно сразу с переводом: /add bank — берег";

async function startAdd(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const parsed = parseAddInput(input);
  if (!parsed) return void (await ctx.reply(USAGE));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;
  if (await findWord(deps.db, room.id, parsed.term)) {
    return void (await ctx.reply(`«${esc(parsed.term)}» уже есть в комнате`, HTML));
  }

  await ctx.replyWithChatAction("typing");
  let enrichment: Enrichment | undefined;
  try {
    enrichment = await deps.enricher.enrich(parsed.term, parsed.translation);
  } catch (err) {
    console.error("Enrichment failed", parsed.term, err);
  }

  const draft = deps.drafts.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    term: parsed.term,
    translation: parsed.translation ?? enrichment?.translation ?? "",
    explanation: enrichment?.explanation ?? "",
    example: enrichment?.example ?? "",
  });
  if (!draft.translation) return askForTranslation(ctx, draft, "Не получилось подобрать перевод для");
  await sendPreview(ctx, draft);
}

export function registerAdd(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("add", (ctx) => background(ctx, () => startAdd(ctx, deps, ctx.match)));

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return next();
    // В группе бот видит всю переписку, поэтому перевод принимаем только ответом на сообщение бота.
    const repliesToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    const awaiting = ctx.chat.type === "private" || repliesToBot ? deps.drafts.findAwaiting(ctx.user.id, ctx.chat.id) : undefined;
    if (awaiting) {
      awaiting.translation = text.trim();
      awaiting.awaitingEdit = false;
      return sendPreview(ctx, awaiting);
    }
    if (ctx.chat.type === "private") return background(ctx, () => startAdd(ctx, deps, text));
    return next();
  });

  bot.callbackQuery(/^d:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const draft = cb?.k === "draft" ? deps.drafts.get(cb.id) : undefined;
    if (cb?.k !== "draft" || !draft || draft.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Этот черновик уже неактуален" }));
    }
    if (cb.action === "edit") {
      await ctx.answerCallbackQuery();
      return askForTranslation(ctx, draft, "Исправляем перевод для");
    }
    if (draft.batchId !== undefined && cb.action !== "cancel") {
      await ctx.answerCallbackQuery();
      return onBatchDraft(ctx, deps, draft, cb.action);
    }
    if (cb.action === "cancel") {
      deps.drafts.delete(draft.id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("❌ Отменено"));
    }
    if (cb.action !== "ok") return void (await ctx.answerCallbackQuery());

    deps.drafts.delete(draft.id);
    const result = await saveWord(deps.db, {
      roomId: draft.roomId,
      addedBy: ctx.user.id,
      draft: { term: draft.term, translation: draft.translation, explanation: draft.explanation, example: draft.example },
      now: deps.now(),
    });
    if (result.status === "duplicate") {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`«${esc(draft.term)}» уже есть в комнате`, HTML));
    }
    await ctx.answerCallbackQuery({ text: "Добавлено!" });
    await ctx.editMessageText(`✅ Добавлено\n\n${draftText(result.word)}`, { ...HTML, reply_markup: wordActionsKeyboard(result.word.id) });
    const { word, members } = result;
    background(ctx, () => broadcastWord(deps, word, members, ctx.user, ctx.chat?.id));
  });
}
