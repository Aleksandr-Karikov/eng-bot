import type { Bot } from "grammy";
import type { Enrichment } from "../../llm/enricher";
import { findWord, MAX_CONTEXT, parseAddInput, saveWord, toWordDraft } from "../../services/words";
import { termPattern } from "../../services/word-uses";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { wordActionsKeyboard } from "../keyboards";
import { draftText, esc } from "../texts";
import { askForTranslation, broadcastWord, commandInput, resolveRoom, sendPreview } from "../word-flow";
import { onBatchDraft } from "./batch";

const USAGE =
  "Напиши слово после команды: /add serendipity\nМожно сразу с переводом: /add bank — берег\nИли ответь командой /add на сообщение с фразой.";

/** context — где встретилось: сообщение, на которое ответили /add, если слово в нём есть. */
export async function startAdd(ctx: BotContext, deps: Deps, input: string, context = ""): Promise<void> {
  const parsed = parseAddInput(input);
  if (!parsed) return void (await ctx.reply(USAGE));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;
  if (await findWord(deps.db, room.id, parsed.term)) {
    return void (await ctx.reply(`«${esc(parsed.term)}» уже есть в комнате`, HTML));
  }

  await ctx.replyWithChatAction("typing");
  // Перевод и запоминалка (другой, более сильной моделью) — параллельно.
  const [enrichment, mnemonic] = await Promise.all([
    deps.enricher.enrich(parsed.term, parsed.translation).catch((err): Enrichment | undefined => {
      console.error("Enrichment failed", parsed.term, err);
      return undefined;
    }),
    deps.tutor
      .mnemonics([{ term: parsed.term, translation: parsed.translation ?? "" }])
      .then(([m]) => m ?? "")
      .catch((err) => {
        console.error("Mnemonic failed", parsed.term, err);
        return "";
      }),
  ]);

  const draft = deps.drafts.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    term: parsed.term,
    translation: parsed.translation ?? enrichment?.translation ?? "",
    explanation: enrichment?.explanation ?? "",
    example: enrichment?.example ?? "",
    transcriptionUk: enrichment?.transcriptionUk ?? "",
    transcriptionUs: enrichment?.transcriptionUs ?? "",
    mnemonic,
    context: context && termPattern(parsed.term).test(context.toLowerCase().replace(/[’‘`]/g, "'")) ? context.slice(0, MAX_CONTEXT) : "",
  });
  if (!draft.translation) return askForTranslation(ctx, deps, draft, "Не получилось подобрать перевод для");
  await sendPreview(ctx, draft);
}

export function registerAdd(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("add", (ctx) => {
    // /add слово ответом на сообщение: само сообщение — контекст, где слово встретилось.
    const own = ctx.match.trim();
    const replied = ctx.message?.reply_to_message;
    const context = own ? (replied?.text ?? replied?.caption ?? "").trim() : "";
    return background(ctx, () => startAdd(ctx, deps, commandInput(ctx), context));
  });

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
      return askForTranslation(ctx, deps, draft, "Исправляем перевод для");
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
      draft: toWordDraft(draft),
      now: deps.now(),
    });
    if (result.status === "no-room") {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("Комнату уже удалили — слово не сохранено. Твои комнаты — /room"));
    }
    if (result.status === "duplicate") {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`«${esc(draft.term)}» уже есть в комнате`, HTML));
    }
    await ctx.answerCallbackQuery({ text: "Добавлено!" });
    await ctx.editMessageText(`✅ Добавлено\n\n${draftText(result.word)}`, { ...HTML, reply_markup: wordActionsKeyboard(result.word.id, Boolean(deps.images)) });
    const { word, members } = result;
    background(ctx, () => broadcastWord(deps, word, members, ctx.user, ctx.chat?.id));
  });
}
