import type { Bot } from "grammy";
import type { ExtractedItem } from "../../llm/enricher";
import { filterNewItems, saveWord, toWordDraft, type WordDraft } from "../../services/words";
import type { Batch } from "../batches";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import type { Draft } from "../drafts";
import { batchKeyboard, batchPageCount, batchUndoKeyboard } from "../keyboards";
import { batchDoneText, batchListText, esc } from "../texts";
import { broadcastBatch, commandInput, resolveRoom, sendPreview } from "../word-flow";
import { downloadImage, ImageTooBigError, imageOf, type ImageRef } from "../files";

const USAGE =
  "Пришли текст или список слов после команды:\n/text It was pure serendipity that we met\nИли ответь командой /text на сообщение или фото — разберу его.";

async function startText(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const text = input.trim();
  if (!text) return void (await ctx.reply(USAGE));
  await offerExtracted(ctx, deps, () => deps.enricher.extract(text), "Не получилось разобрать текст 😔 Попробуй ещё раз чуть позже");
}

/** Скриншот или фото страницы: Claude читает текст с картинки и выбирает слова, как из текста. note — подпись. */
async function startImage(ctx: BotContext, deps: Deps, image: ImageRef, note: string): Promise<void> {
  await offerExtracted(
    ctx,
    deps,
    async () => deps.enricher.extractImage(await downloadImage(ctx.api, image), note || undefined),
    "Не получилось разобрать картинку 😔 Попробуй ещё раз чуть позже",
  );
}

async function offerExtracted(ctx: BotContext, deps: Deps, extract: () => Promise<ExtractedItem[]>, failText: string): Promise<void> {
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;

  await ctx.replyWithChatAction("typing");
  let items: ExtractedItem[];
  try {
    items = await extract();
  } catch (err) {
    if (err instanceof ImageTooBigError) return void (await ctx.reply("Картинка слишком большая — пришли её как фото, а не файлом"));
    console.error("Extraction failed", err);
    return void (await ctx.reply(failText));
  }
  if (items.length === 0) return void (await ctx.reply("Не нашёл тут английского текста 🤔"));
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
  batch.finished = true;
  await ctx.reply(batchDoneText(batch.saved), {
    ...HTML,
    reply_markup: batch.saved.length ? batchUndoKeyboard(batch.id, batch.saved.length) : undefined,
  });
  const saved = [...batch.saved];
  background(ctx, () => broadcastBatch(deps, batch.roomId, saved, ctx.user, ctx.chat?.id));
  // Запоминалки для пачки — в фоне одним запросом на 20 слов, чтобы не держать список.
  void deps.mnemonicGen.ensureMany(saved.map((w) => w.id)).catch((err) => console.error("Batch mnemonics failed", err));
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
  if (!batch || batch.finished) return void (await ctx.editMessageText("Эта пачка уже неактуальна"));

  if (action === "ok") {
    await saveItems(deps, batch, [toWordDraft(draft)]);
    await ctx.editMessageText(`✅ <b>${esc(draft.term)}</b>`, HTML);
  } else {
    await ctx.editMessageText(`⏭ <b>${esc(draft.term)}</b>`, HTML);
  }
  if (action === "stop") return finish(ctx, deps, batch);
  batch.position++;
  await showCurrent(ctx, deps, batch);
}

export function registerBatch(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("text", (ctx) => {
    // Картинка в самой команде (/text в подписи к фото) или в сообщении, на которое ответили.
    const image = imageOf(ctx.message) ?? imageOf(ctx.message?.reply_to_message);
    const own = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (image) return background(ctx, () => startImage(ctx, deps, image, own));
    return background(ctx, () => startText(ctx, deps, commandInput(ctx)));
  });

  // В личке картинку можно прислать просто так — как и текст.
  bot.on(["message:photo", "message:document"], async (ctx, next) => {
    const image = imageOf(ctx.message);
    if (ctx.chat.type !== "private" || !image) return next();
    background(ctx, () => startImage(ctx, deps, image, ctx.message.caption ?? ""));
  });

  bot.callbackQuery(/^bt:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batchToggle" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batchToggle" || !batch || batch.finished || batch.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Это не твоя пачка или она уже неактуальна" }));
    }
    batch.toggle(cb.index);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: batchKeyboard(batch) });
  });

  bot.callbackQuery(/^bp:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batchPage" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batchPage" || !batch || batch.finished || batch.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Это не твоя пачка или она уже неактуальна" }));
    }
    await ctx.answerCallbackQuery();
    if (cb.page === batch.page || cb.page < 0 || cb.page >= batchPageCount(batch)) return;
    batch.page = cb.page;
    await ctx.editMessageReplyMarkup({ reply_markup: batchKeyboard(batch) });
  });

  bot.callbackQuery(/^b:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batch" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batch" || !batch || batch.finished || batch.userId !== ctx.user.id) {
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
