import { langForms } from "../../lang";
import { rateUsefulness } from "../../services/usefulness";
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
import { findYoutubeUrl, YoutubeBlockedError, type Subtitles } from "../../youtube/subtitles";
import { allowQuota, spendWordQuota } from "./quota";
import { QUOTAS, wordsLeft } from "../../services/limits";

const USAGE =
  "Пришли текст или список слов после команды:\n/text It was pure serendipity that we met\nИли ответь командой /text на сообщение или фото — разберу его.";

/** Сколько субтитров отдавать Claude: примерно 15 минут речи — дальше слов и так наберётся сотня. */
const MAX_SUBTITLE_CHARS = 15_000;

async function startYoutube(ctx: BotContext, deps: Deps, url: string): Promise<void> {
  if (!deps.youtube) return void (await ctx.reply("Ссылки на YouTube пока не разбираю — не установлен youtube-transcript-api"));
  await ctx.reply("🎬 Достаю субтитры…");
  let subs: Subtitles | undefined;
  try {
    subs = await deps.youtube.fetch(url);
  } catch (err) {
    if (err instanceof YoutubeBlockedError) {
      return void (await ctx.reply("YouTube сейчас не отдаёт субтитры боту 😔 Попробуй позже или скопируй расшифровку и пришли текстом: /text …"));
    }
    console.error("Subtitles failed", url, err);
    return void (await ctx.reply("Не получилось достать субтитры 😔 Проверь ссылку или попробуй позже"));
  }
  if (!subs) return void (await ctx.reply(`У этого видео нет ${langForms().genPl} субтитров 🤷`));
  const cut = subs.text.length > MAX_SUBTITLE_CHARS;
  const text = subs.text.slice(0, MAX_SUBTITLE_CHARS);
  await ctx.reply(`🎬 ${subs.title ? `«${esc(subs.title)}» — ` : ""}ищу слова${cut ? " (в первой четверти часа)" : ""}…`, HTML);
  await offerExtracted(ctx, deps, () => deps.enricher.extract(text), "Не получилось разобрать субтитры 😔 Попробуй ещё раз чуть позже");
}

async function startText(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const text = input.trim();
  if (!text) return void (await ctx.reply(USAGE));
  const url = findYoutubeUrl(text);
  // Одна ссылка (возможно, с парой слов вокруг) — разбираем видео, а не текст сообщения.
  if (url && text.length - url.length < 40) return startYoutube(ctx, deps, url);
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
  // Единый вход для всех трёх путей разбора — /text, фото и ссылки на YouTube. Проверка здесь, а не в
  // каждом: лимит на текст, картинку и субтитры — один и тот же расход, и обойти его сменой пути нельзя.
  // Стоит до самой работы: субтитры тоже качаются, и отказывать после них было бы обидно.
  if (!(await allowQuota(ctx, deps, "text"))) return;
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
  if (items.length === 0) {
    return void (await ctx.reply(`Не нашёл, что стоит выучить: тут либо нет ${langForms().gen}, либо только самые простые слова 🤔\nНужна именно эта фраза — добавь её: /add фраза`));
  }
  // Самые полезные — в начале списка; необязательные — в конце, но тоже отмечены: решает человек.
  const rated = await rateUsefulness(await filterNewItems(deps.db, room.id, items), deps.frequency);
  const fresh = rated.sort((a, b) => (b.usefulness ?? 2) - (a.usefulness ?? 2));
  if (fresh.length === 0) return void (await ctx.reply("Ничего нового не нашёл — всё уже есть в комнате 👌"));

  // Сколько слов ещё помещается: обрезаем пачку до остатка, иначе показывали бы список из 100 слов,
  // из которых сохранятся три. Проверка стоит после отбора — до неё неизвестно, сколько слов вообще новых.
  const { left, kind } = await wordsLeft(deps.db, { userId: ctx.user.id, timeZone: ctx.user.timezone, now: deps.now() });
  if (left <= 0) return void (await ctx.reply(QUOTAS[kind].refusal, HTML));
  const batch = deps.batches.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    timezone: ctx.user.timezone,
    left,
    items: fresh.slice(0, left),
  });
  await ctx.reply(batchListText(batch.items.length), { reply_markup: batchKeyboard(batch) });
}

/**
 * Сохраняет слова из пачки, пропуская появившиеся тем временем дубли.
 *
 * Здесь же расходуется лимит на слова — на каждое **действительно сохранённое**: дубль и слово в
 * удалённую комнату места не занимают. Проверка лимита стоит в `offerExtracted`, то есть пачку вообще
 * не показывают, когда дневной лимит выбран; при частичном остатке пачка сохранит столько, сколько
 * помещается, и остановится — остальное человек добавит завтра.
 */
async function saveItems(deps: Deps, batch: Batch, items: WordDraft[]): Promise<void> {
  for (const draft of items) {
    if (batch.saved.length >= batch.left) break;
    const result = await saveWord(deps.db, { roomId: batch.roomId, addedBy: batch.userId, draft, now: deps.now() });
    if (result.status !== "saved") continue;
    // Именно `userId`: у `Batch.id` — номер пачки, а не человек, и счётчик ушёл бы не тому.
    await spendWordQuota(deps, { userId: batch.userId, timezone: batch.timezone });
    batch.saved.push(result.word);
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

  if (action === "ok") await saveItems(deps, batch, [toWordDraft(draft)]);
  // Пометка на прошлой карточке — косметика: не вышло (лимит Telegram) — следующую карточку всё равно показываем.
  await ctx.editMessageText(`${action === "ok" ? "✅" : "⏭"} <b>${esc(draft.term)}</b>`, HTML).catch((err) => console.error("Batch card mark failed", err));
  if (action === "stop") return finish(ctx, deps, batch);
  batch.position++;
  await showCurrent(ctx, deps, batch);
}

/** Идёт ли правка клавиатуры пачки и изменилась ли пачка с её начала. */
const keyboardSync = new WeakMap<Batch, { running: boolean; dirty: boolean }>();

/**
 * Галочки и страницы пачки: одна правка клавиатуры за раз и всегда с последним состоянием. Частые нажатия
 * (особенно в группе, где у Telegram лимит ~20 правок в минуту) схлопываются, а не копятся в очередь из устаревших правок.
 */
function syncKeyboard(ctx: BotContext, batch: Batch): void {
  const sync = keyboardSync.get(batch) ?? { running: false, dirty: false };
  keyboardSync.set(batch, sync);
  sync.dirty = true;
  if (sync.running) return;
  sync.running = true;
  void (async () => {
    while (sync.dirty && !batch.finished) {
      sync.dirty = false;
      await ctx.editMessageReplyMarkup({ reply_markup: batchKeyboard(batch) }).catch((err) => console.error("Batch keyboard failed", err));
    }
    sync.running = false;
  })();
}

export function registerBatch(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("text", (ctx) => {
    // Картинка в самой команде (/text в подписи к фото) или в сообщении, на которое ответили.
    const image = imageOf(ctx.message) ?? imageOf(ctx.message?.reply_to_message);
    const own = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (image) return background(ctx, () => startImage(ctx, deps, image, own));
    return background(ctx, () => startText(ctx, deps, commandInput(ctx)));
  });

  // В личке ссылку на YouTube можно прислать просто так. Раньше /add: иначе ссылка стала бы «словом».
  bot.on("message:text", async (ctx, next) => {
    const url = ctx.chat.type === "private" && !ctx.message.text.startsWith("/") ? findYoutubeUrl(ctx.message.text) : undefined;
    if (!url || deps.talks.get(ctx.user.id)) return next();
    background(ctx, () => startYoutube(ctx, deps, url));
  });

  // Картинка в личке — просто так, как и текст; в группе — с подписью /text.
  // Команды в подписи grammY не распознаёт (bot.command смотрит только текст), поэтому разбираем подпись сами.
  bot.on(["message:photo", "message:document"], async (ctx, next) => {
    const image = imageOf(ctx.message);
    const caption = (ctx.message.caption ?? "").trim();
    const command = new RegExp(`^/text(?:@${ctx.me.username})?(?:\\s+|$)`, "i").exec(caption);
    if (!image || (ctx.chat.type !== "private" && !command)) return next();
    const note = command ? caption.slice(command[0].length).trim() : caption;
    background(ctx, () => startImage(ctx, deps, image, note));
  });

  bot.callbackQuery(/^bt:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "batchToggle" ? deps.batches.get(cb.id) : undefined;
    if (cb?.k !== "batchToggle" || !batch || batch.finished || batch.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Это не твоя пачка или она уже неактуальна" }));
    }
    batch.toggle(cb.index);
    await ctx.answerCallbackQuery();
    syncKeyboard(ctx, batch);
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
    syncKeyboard(ctx, batch);
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
