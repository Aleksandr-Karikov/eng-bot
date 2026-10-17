import { InputFile, type Bot } from "grammy";
import { getWord, setAudioFileId } from "../../services/words";
import { decodeCb } from "../callbacks";
import type { BotContext, Deps } from "../context";

export function registerAudio(bot: Bot<BotContext>, deps: Deps): void {
  bot.callbackQuery(/^a:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "audio") return void (await ctx.answerCallbackQuery());
    const word = await getWord(deps.db, cb.wordId);
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));

    const cached = cb.accent === "uk" ? word.audioUkFileId : word.audioUsFileId;
    let voice: string | InputFile;
    if (cached) {
      voice = cached;
    } else {
      try {
        voice = new InputFile(await deps.speech.synthesize(word.term, cb.accent), "pronunciation.ogg");
      } catch (err) {
        console.error("Speech synthesis failed", word.term, err);
        return void (await ctx.answerCallbackQuery({ text: "Озвучка недоступна 😔" }));
      }
    }
    void ctx.answerCallbackQuery().catch(() => {});
    const message = await ctx.replyWithVoice(voice);
    if (!cached) await setAudioFileId(deps.db, word.id, cb.accent, message.voice.file_id);
    if (ctx.chat?.type === "private") deps.voices.add(ctx.user.id, message.message_id);
  });
}
