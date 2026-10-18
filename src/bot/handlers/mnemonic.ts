import { InputFile, type Bot } from "grammy";
import type { Word } from "../../db/schema";
import { STYLE_PRESETS } from "../../images/images";
import { getWord, setImageFileId } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { mnemonicKeyboard, pictureKeyboard, redrawMenuKeyboard } from "../keyboards";
import { clearPendingInputs } from "../pending";
import { esc, mnemonicText, pictureCaption } from "../texts";

/** Запоминалка слова: из базы или свежая от Claude. "" — не получилось. */
async function ensureMnemonic(deps: Deps, wordId: number): Promise<string> {
  const word = await getWord(deps.db, wordId);
  if (word?.mnemonic) return word.mnemonic;
  await deps.mnemonicGen.ensure(wordId);
  return (await getWord(deps.db, wordId))?.mnemonic ?? "";
}

/** Рисует (или перерисовывает) картинку слова, отправляет её и делает картинкой слова для всей комнаты. */
async function drawAndSend(ctx: BotContext, deps: Deps, word: Word, opts: { style?: string; wish?: string } = {}): Promise<void> {
  if (!deps.images) return;
  await ctx.replyWithChatAction("upload_photo").catch(() => {});
  let picture: Buffer;
  try {
    picture = await deps.images.drawWord(word, opts);
  } catch (err) {
    console.error("Picture failed", word.term, err);
    return void (await ctx.reply("Не получилось нарисовать картинку 😔 Попробуй позже"));
  }
  const message = await ctx.replyWithPhoto(new InputFile(picture, "picture.png"), {
    ...HTML,
    caption: pictureCaption(word.term, word.translation),
    has_spoiler: true,
    reply_markup: pictureKeyboard(word.id),
  });
  const best = message.photo.at(-1);
  if (best) await setImageFileId(deps.db, word.id, best.file_id);
}

function drawingNotice(deps: Deps): string {
  const queue = deps.images?.queued ?? 0;
  return queue ? `🖼 В очереди (${queue} до тебя), потом ~20 секунд` : "🖼 Рисую, это около 20 секунд…";
}

export function registerMnemonic(bot: Bot<BotContext>, deps: Deps): void {
  bot.callbackQuery(/^mn:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "mnemonic" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    await ctx.answerCallbackQuery(word.mnemonic ? {} : { text: "💡 Придумываю…" });
    background(ctx, async () => {
      const mnemonic = await ensureMnemonic(deps, word.id);
      if (!mnemonic) return void (await ctx.reply("Не получилось придумать запоминалку 😔 Попробуй ещё раз чуть позже"));
      const fresh = await getWord(deps.db, word.id);
      await ctx.reply(mnemonicText(word.term, mnemonic), {
        ...HTML,
        reply_markup: deps.images ? mnemonicKeyboard(word.id, Boolean(fresh?.imageFileId)) : undefined,
      });
    });
  });

  bot.callbackQuery(/^im:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (!deps.images) return void (await ctx.answerCallbackQuery({ text: "Картинки сейчас выключены" }));
    const word = cb?.k === "picture" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    const options = { ...HTML, caption: pictureCaption(word.term, word.translation), has_spoiler: true, reply_markup: pictureKeyboard(word.id) };
    if (word.imageFileId) {
      void ctx.answerCallbackQuery().catch(() => {});
      return void (await ctx.replyWithPhoto(word.imageFileId, options));
    }
    const painted = deps.pictures?.find(word);
    if (painted) {
      void ctx.answerCallbackQuery().catch(() => {});
      const sent = await ctx.replyWithPhoto(new InputFile(painted), options);
      const best = sent.photo.at(-1);
      if (best) await setImageFileId(deps.db, word.id, best.file_id);
      return;
    }
    await ctx.answerCallbackQuery({ text: drawingNotice(deps) });
    background(ctx, () => drawAndSend(ctx, deps, word));
  });

  bot.callbackQuery(/^rd:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (!deps.images) return void (await ctx.answerCallbackQuery({ text: "Картинки сейчас выключены" }));
    const word = cb?.k === "redraw" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    await ctx.answerCallbackQuery();
    await ctx.reply(`🔄 Как перерисовать <b>${esc(word.term)}</b>? Новая картинка заменит старую для всей комнаты.`, {
      ...HTML,
      reply_markup: redrawMenuKeyboard(word.id, STYLE_PRESETS),
    });
  });

  bot.callbackQuery(/^rv:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (!deps.images) return void (await ctx.answerCallbackQuery({ text: "Картинки сейчас выключены" }));
    const word = cb?.k === "redrawAs" ? await getWord(deps.db, cb.wordId) : undefined;
    if (cb?.k !== "redrawAs" || !word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (cb.how === "custom") {
      await ctx.answerCallbackQuery();
      if (!ctx.chat) return;
      clearPendingInputs(deps, ctx.user.id);
      deps.pictureWishes.ask(ctx.user.id, word.id, ctx.chat.id);
      return void (await ctx.reply(`✍️ Опиши картинку для <b>${esc(word.term)}</b> любыми словами — ответом на это сообщение.`, {
        ...HTML,
        reply_markup: { force_reply: true },
      }));
    }
    const style = typeof cb.how === "number" ? STYLE_PRESETS[cb.how]?.style : undefined;
    await ctx.answerCallbackQuery({ text: drawingNotice(deps) });
    background(ctx, () => drawAndSend(ctx, deps, word, style ? { style } : {}));
  });

  // Описание для «✍️ Свой вариант». Регистрируется раньше общего обработчика текста (иначе стало бы /add).
  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    if (ctx.chat.type !== "private" && ctx.message.reply_to_message?.from?.id !== ctx.me.id) return next();
    const wordId = deps.pictureWishes.take(ctx.user.id, ctx.chat.id);
    if (wordId === undefined) return next();
    const word = await getWord(deps.db, wordId);
    if (!word || !deps.images) return void (await ctx.reply("Это слово уже удалили"));
    await ctx.reply(drawingNotice(deps));
    background(ctx, () => drawAndSend(ctx, deps, word, { wish: ctx.message.text.trim() }));
  });
}
