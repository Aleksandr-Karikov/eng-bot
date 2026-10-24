import { InputFile, type Bot } from "grammy";
import type { Word } from "../../db/schema";
import { withLang } from "../../lang";
import { getWord, setAudioFileId, wordLanguage } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, type BotContext, type Deps } from "../context";

type Accent = "uk" | "us";

/** Озвучка слова: уже загруженная в Telegram (file_id) или свежая. undefined — синтез не удался. */
export async function wordVoice(deps: Deps, word: Word, accent: Accent): Promise<string | InputFile | undefined> {
  const cached = accent === "uk" ? word.audioUkFileId : word.audioUsFileId;
  if (cached) return cached;
  try {
    // Язык — по комнате слова: его могут озвучивать и из другой комнаты (слово друга, «знаешь?»).
    const lang = await wordLanguage(deps.db, word.id);
    return new InputFile(await withLang(lang, () => deps.speech.synthesize(word.term, accent)), "pronunciation.ogg");
  } catch (err) {
    console.error("Speech synthesis failed", word.term, err);
    return undefined;
  }
}

/** Отправляет озвучку; новую запоминает по file_id, в личке — убирается при следующей карточке. */
export async function sendWordVoice(ctx: BotContext, deps: Deps, word: Word, accent: Accent, voice: string | InputFile): Promise<void> {
  const message = await ctx.replyWithVoice(voice);
  if (typeof voice !== "string") await setAudioFileId(deps.db, word.id, accent, message.voice.file_id);
  if (ctx.chat?.type === "private") deps.voices.add(ctx.user.id, message.message_id);
}

export function registerAudio(bot: Bot<BotContext>, deps: Deps): void {
  bot.callbackQuery(/^a:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "audio") return void (await ctx.answerCallbackQuery());
    const word = await getWord(deps.db, cb.wordId);
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    const cached = cb.accent === "uk" ? word.audioUkFileId : word.audioUsFileId;
    if (cached) {
      void ctx.answerCallbackQuery().catch(() => {});
      return sendWordVoice(ctx, deps, word, cb.accent, cached);
    }
    // Синтез — в фоне: say + ffmpeg занимают секунду-другую, а апдейты обрабатываются по очереди.
    void ctx.answerCallbackQuery().catch(() => {});
    background(ctx, async () => {
      const voice = await wordVoice(deps, word, cb.accent);
      if (!voice) return void (await ctx.reply("Озвучка недоступна 😔"));
      await sendWordVoice(ctx, deps, word, cb.accent, voice);
    });
  });
}
