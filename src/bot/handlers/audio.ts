import { InputFile, type Bot } from "grammy";
import type { Word } from "../../db/schema";
import { getWord, setAudioFileId } from "../../services/words";
import { decodeCb } from "../callbacks";
import type { BotContext, Deps } from "../context";

type Accent = "uk" | "us";

/** Озвучка слова: уже загруженная в Telegram (file_id) или свежая. undefined — синтез не удался. */
export async function wordVoice(deps: Deps, word: Word, accent: Accent): Promise<string | InputFile | undefined> {
  const cached = accent === "uk" ? word.audioUkFileId : word.audioUsFileId;
  if (cached) return cached;
  try {
    return new InputFile(await deps.speech.synthesize(word.term, accent), "pronunciation.ogg");
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
    const voice = await wordVoice(deps, word, cb.accent);
    if (!voice) return void (await ctx.answerCallbackQuery({ text: "Озвучка недоступна 😔" }));
    void ctx.answerCallbackQuery().catch(() => {});
    await sendWordVoice(ctx, deps, word, cb.accent, voice);
  });
}
