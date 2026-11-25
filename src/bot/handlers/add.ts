import { langForms } from "../../lang";
import type { Bot } from "grammy";
import { checkAndCount, QUOTAS, refundWordQuota, wordsLeft } from "../../services/limits";
import { MAX_CONTEXT, parseAddInput, saveWord, toWordDraft } from "../../services/words";
import { prepareWord } from "../../services/prepare-word";
import { termPattern } from "../../services/word-uses";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { wordActionsKeyboard } from "../keyboards";
import { draftText, esc } from "../texts";
import { askForTranslation, broadcastWord, commandInput, resolveRoom, sendPreview } from "../word-flow";
import { onBatchDraft } from "./batch";
import { spendWordQuota } from "./quota";

const USAGE =
  "Напиши слово после команды: /add serendipity\nМожно сразу с переводом: /add bank — берег\nИли ответь командой /add на сообщение с фразой.";

/** context — где встретилось: сообщение, на которое ответили /add, если слово в нём есть. */
export async function startAdd(ctx: BotContext, deps: Deps, input: string, context = ""): Promise<void> {
  const parsed = parseAddInput(input);
  if (!parsed) return void (await ctx.reply(USAGE));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;
  // Лимит проверяется до `prepareWord`: иначе человек ждал бы перевод от модели и только потом узнавал,
  // что слов на сегодня больше нет. Расход `add_word` — в `spendWordQuota`, уже после сохранения:
  // отказаться от черновика человек вправе и место в лимите слов за это не теряет.
  //
  // Но черновик сам стоит денег — это два вызова модели (`enrich` и `mnemonics`). Без счётчика `draft`
  // цикл `/add` по разным словам давал неограниченные платные вызовы: `wordsLeft` только читает,
  // а сохранять человек не обязан.
  const left = await wordsLeft(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
  if (left.left <= 0) return void (await ctx.reply(QUOTAS[left.kind].refusal, HTML));
  const draftQuota = await checkAndCount(deps.db, { userId: ctx.user.id, kind: "draft", timeZone: ctx.user.timezone, now: deps.now() });
  if (!draftQuota.allowed) return void (await ctx.reply(draftQuota.refusal, HTML));
  await ctx.replyWithChatAction("typing");
  const prepared = await prepareWord(deps, room.id, parsed);
  if (prepared.status === "exists") return void (await ctx.reply(`«${esc(prepared.term)}» уже есть в комнате`, HTML));
  if (prepared.status === "no-english") {
    return void (await ctx.reply(`Не получилось подобрать ${langForms().neut} слово для «${esc(prepared.term)}». Напиши сразу ${langForms().adv}: /add ${"tooth"}`, HTML));
  }
  const word = prepared.draft;

  const draft = deps.drafts.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    ...word,
    context: context && termPattern(word.term).test(context.toLowerCase().replace(/[’‘`]/g, "'")) ? context.slice(0, MAX_CONTEXT) : "",
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
      // В фоне: при лимите Telegram шаг ждёт и повторяет — апдейты остальных при этом не стоят.
      const action = cb.action;
      return background(ctx, () => onBatchDraft(ctx, deps, draft, action));
    }
    if (cb.action === "cancel") {
      deps.drafts.delete(draft.id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("❌ Отменено"));
    }
    if (cb.action !== "ok") return void (await ctx.answerCallbackQuery());

    deps.drafts.delete(draft.id);
    // Место в лимите занимается ДО записи: иначе отказ приходил бы после сохранения, и не превысить
    // лимит можно было бы только удалением уже добавленного слова (E25).
    if (!(await spendWordQuota(deps, { userId: ctx.user.id, timezone: ctx.user.timezone }))) {
      const left = await wordsLeft(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
      const kind = left.left <= 0 ? left.kind : "add_word";
      await ctx.answerCallbackQuery({ text: "Лимит слов" });
      return void (await ctx.editMessageText(QUOTAS[kind].refusal, HTML));
    }
    const result = await saveWord(deps.db, {
      roomId: draft.roomId,
      addedBy: ctx.user.id,
      draft: toWordDraft(draft),
      now: deps.now(),
    });
    if (result.status === "no-room") {
      // Место уже занято, а слова нет — возвращаем, иначе оно потеряно зря.
      await refundWordQuota(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("Комнату уже удалили — слово не сохранено. Твои комнаты — /room"));
    }
    if (result.status === "duplicate") {
      await refundWordQuota(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`«${esc(draft.term)}» уже есть в комнате`, HTML));
    }
    if (result.status === "too-long") {
      await refundWordQuota(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`Слишком длинно: до ${result.limit} символов. Для фразы такого размера лучше добавить отдельные слова`, HTML));
    }
    await ctx.answerCallbackQuery({ text: "Добавлено!" });
    await ctx.editMessageText(`✅ Добавлено\n\n${draftText(result.word)}`, { ...HTML, reply_markup: wordActionsKeyboard(result.word.id, Boolean(deps.images)) });
    const { word, members } = result;
    background(ctx, () => broadcastWord(deps, word, members, ctx.user));
  });
}
