import { InputFile, type Bot } from "grammy";
import { getWord, setImageFileId } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { mnemonicKeyboard } from "../keyboards";
import { mnemonicText, pictureCaption } from "../texts";

/** Запоминалка слова: из базы или свежая от Claude. "" — не получилось. */
async function ensureMnemonic(deps: Deps, wordId: number): Promise<string> {
  const word = await getWord(deps.db, wordId);
  if (word?.mnemonic) return word.mnemonic;
  await deps.mnemonicGen.ensure(wordId);
  return (await getWord(deps.db, wordId))?.mnemonic ?? "";
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
    const images = deps.images;
    const word = cb?.k === "picture" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (word.imageFileId) {
      void ctx.answerCallbackQuery().catch(() => {});
      return void (await ctx.replyWithPhoto(word.imageFileId, { ...HTML, caption: pictureCaption(word.term, word.translation), has_spoiler: true }));
    }
    const painted = deps.pictures?.find(word);
    if (painted) {
      void ctx.answerCallbackQuery().catch(() => {});
      const sent = await ctx.replyWithPhoto(new InputFile(painted), { ...HTML, caption: pictureCaption(word.term, word.translation), has_spoiler: true });
      const best = sent.photo.at(-1);
      if (best) await setImageFileId(deps.db, word.id, best.file_id);
      return;
    }
    const queue = images.queued;
    await ctx.answerCallbackQuery({ text: queue ? `🖼 В очереди (${queue} до тебя), потом ~20 секунд` : "🖼 Рисую, это около 20 секунд…" });
    background(ctx, async () => {
      await ctx.replyWithChatAction("upload_photo").catch(() => {});
      let picture: Buffer;
      try {
        picture = await images.drawWord(word);
      } catch (err) {
        console.error("Picture failed", word.term, err);
        return void (await ctx.reply("Не получилось нарисовать картинку 😔 Попробуй позже"));
      }
      // Пока рисовали, картинку могли уже отправить по другому нажатию — тогда не дублируем в кэш.
      const message = await ctx.replyWithPhoto(new InputFile(picture, "picture.png"), {
        ...HTML,
        caption: pictureCaption(word.term, word.translation),
        has_spoiler: true,
      });
      const best = message.photo.at(-1);
      if (best && !(await getWord(deps.db, word.id))?.imageFileId) await setImageFileId(deps.db, word.id, best.file_id);
    });
  });
}
