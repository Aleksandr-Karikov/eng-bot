import type { Voice } from "grammy/types";
import type { BotContext, Deps } from "./context";
import { downloadFile } from "./files";

/** Дольше — это уже монолог: распознаётся долго, а в разговоре и для произношения не нужно. */
export const MAX_VOICE_SECONDS = 120;

/** Голосовое как файл; не подходит — объясняет человеку и возвращает undefined. */
export async function voiceAudio(ctx: BotContext, deps: Deps, voice: Voice): Promise<Buffer | undefined> {
  if (!deps.recognizer) return void (await ctx.reply("Голосовые пока не понимаю — напиши текстом 🙂"));
  if (voice.duration > MAX_VOICE_SECONDS) return void (await ctx.reply(`Слишком длинное голосовое — давай до ${MAX_VOICE_SECONDS / 60} минут 🙂`));
  return downloadFile(ctx.api, voice.file_id);
}

/** Текст голосового (по-английски); не расслышал или не вышло — сообщает сам и возвращает undefined. */
export async function hearVoice(ctx: BotContext, deps: Deps, voice: Voice): Promise<string | undefined> {
  const audio = await voiceAudio(ctx, deps, voice);
  if (!audio) return undefined;
  await ctx.replyWithChatAction("typing");
  let text: string;
  try {
    text = (await deps.recognizer!.transcribe(audio)).trim();
  } catch (err) {
    console.error("Voice transcription failed", err);
    return void (await ctx.reply("Не получилось распознать голосовое 😔 Попробуй ещё раз или напиши текстом."));
  }
  if (!text) return void (await ctx.reply("Не расслышал 🤔 Запиши ещё раз, чуть ближе к микрофону."));
  return text;
}
