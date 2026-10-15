import type { Bot } from "grammy";
import type { ExtractedItem } from "../../llm/enricher";
import { filterNewItems, saveWord, type WordDraft } from "../../services/words";
import type { Batch } from "../batches";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { Draft } from "../drafts";
import { batchKeyboard } from "../keyboards";
import { batchDoneText, batchListText, esc } from "../texts";
import { broadcastBatch, resolveRoom, sendPreview } from "../word-flow";

const USAGE = "Пришли текст или список слов после команды:\n/text It was pure serendipity that we met";
const MAX_TEXT = 3000;

async function startText(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const text = input.trim();
  if (!text) return void (await ctx.reply(USAGE));
  if (text.length > MAX_TEXT) return void (await ctx.reply(`Слишком длинно — пришли до ${MAX_TEXT} символов за раз`));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;

  await ctx.replyWithChatAction("typing");
  let items: ExtractedItem[];
  try {
    items = await deps.enricher.extract(text);
  } catch (err) {
    console.error("Extraction failed", err);
    return void (await ctx.reply("Не получилось разобрать текст 😔 Попробуй ещё раз чуть позже"));
  }
  const fresh = await filterNewItems(deps.db, room.id, items);
  if (fresh.length === 0) return void (await ctx.reply("Ничего нового не нашёл — всё уже есть в комнате 👌"));

  const batch = deps.batches.create({ userId: ctx.user.id, chatId: ctx.chat.id, roomId: room.id, items: fresh });
  await ctx.reply(batchListText(fresh.length), { reply_markup: batchKeyboard(batch) });
}

/** Сохраняет слова из пачки, пропуская появившиеся тем временем дубли. */
async function saveItems(deps: Deps, batch: Batch, items: WordDraft[]): Promise<void> {
  for (const draft of items) {
    const result = await saveWord(deps.db, { roomId: batch.roomId, addedBy: batch.userId, draft, now: deps.now() });
    if (result.status === "saved") batch.saved.push(result.word);
  }
}

async function finish(ctx: BotContext, deps: Deps, batch: Batch): Promise<void> {
  deps.batches.delete(batch.id);
  await ctx.reply(batchDoneText(batch.saved), HTML);
  const saved = [...batch.saved];
  background(ctx, () => broadcastBatch(deps, batch.roomId, saved, ctx.user, ctx.chat?.id));
}

async function showCurrent(ctx: BotContext, deps: Deps, batch: Batch): Promise<void> {
  const index = batch.queue[batch.position];
  if (index === undefined) return finish(ctx, deps, batch);
  const draft = deps.drafts.create({ userId: batch.userId, chatId: batch.chatId, roomId: batch.roomId, ...batch.items[index] });
  draft.batchId = batch.id;
  draft.progress = `${batch.position + 1}/${batch.queue.length}`;
  await sendPreview(ctx, draft);
}

/** Кнопки черновика в режиме «по одному»: ✅ сохраняет, ⏭ пропускает, ⏹ завершает пачку. */
export async function onBatchDraft(ctx: BotContext, deps: Deps, draft: Draft, action: "ok" | "skip" | "stop"): Promise<void> {
  const batch = draft.batchId !== undefined ? deps.batches.get(draft.batchId) : undefined;
  deps.drafts.delete(draft.id);
  if (!batch) return void (await ctx.editMessageText("Эта пачка уже неактуальна"));

  if (action === "ok") {
    await saveItems(deps, batch, [{ term: draft.term, translation: draft.translation, explanation: draft.explanation, example: draft.example }]);
    await ctx.editMessageText(`✅ <b>${esc(draft.term)}</b>`, HTML);
  } else {
    await ctx.editMessageText(`⏭ <b>${esc(draft.term)}</b>`, HTML);
  }
  if (action === "stop") return finish(ctx, deps, batch);
  batch.position++;
  await showCurrent(ctx, deps, batch);
}

export function registerBatch(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("text", (ctx) => background(ctx, () => startText(ctx, deps, ctx.match)));

  bot.callbackQuery(/^bt:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batchToggle" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batchToggle" || !batch || batch.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Это не твоя пачка или она уже неактуальна" }));
    }
    batch.toggle(cb.index);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: batchKeyboard(batch) });
  });

  bot.callbackQuery(/^b:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batch" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batch" || !batch || batch.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Это не твоя пачка или она уже неактуальна" }));
    }
    if (cb.action === "cancel") {
      deps.batches.delete(batch.id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("❌ Отменено"));
    }
    const selected = batch.selectedItems();
    if (selected.length === 0) return void (await ctx.answerCallbackQuery({ text: "Ничего не отмечено" }));
    await ctx.answerCallbackQuery();

    if (cb.action === "review") {
      batch.queue = batch.selected.flatMap((on, i) => (on ? [i] : []));
      batch.position = 0;
      await ctx.editMessageText(`🔍 Проверяем по одному: ${selected.length}`);
      return showCurrent(ctx, deps, batch);
    }
    await ctx.editMessageText(batchListText(batch.items.length));
    await saveItems(deps, batch, selected);
    await finish(ctx, deps, batch);
  });
}
