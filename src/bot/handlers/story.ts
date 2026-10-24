import { isLangCode, withLang } from "../../lang";
import { InputFile, type Api, type Bot } from "grammy";
import type { Room } from "../../db/schema";
import { findRoomByChat, getRoom } from "../../services/rooms";
import { getStory, saveStory, setStoryAudio, storyGlossary, storyQuestions, storyWords } from "../../services/stories";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { storyKeyboard, storyQuestionKeyboard } from "../keyboards";
import { storyAnswerAlert, storyQuestionText, storyText } from "../texts";

/** Меньше — история выходит про одно-два слова, смысла мало. */
const MIN_WORDS = 3;

type StoryDeps = Pick<Deps, "db" | "tutor" | "random" | "now">;

/**
 * Пишет историю из слов комнаты и отправляет её в чат с вопросами на понимание.
 * userId — история для одного человека: в неё попадут слова, которые он забывал. false — слов мало.
 */
export async function publishStory(api: Api, deps: StoryDeps, chatId: number, room: Room, userId?: number): Promise<boolean> {
  const glossary = await storyWords(deps.db, room.id, deps.random, userId);
  if (glossary.length < MIN_WORDS) return false;
  // Истории выходят и по расписанию, вне апдейта, — язык берём у комнаты.
  const draft = await withLang(isLangCode(room.language) ? room.language : "en", () => deps.tutor.story(glossary));
  const story = await saveStory(deps.db, room.id, draft, glossary, deps.now());
  await api.sendMessage(chatId, storyText(story, glossary), { ...HTML, reply_markup: storyKeyboard(story.id) });
  for (const [i, q] of draft.questions.entries()) {
    await api.sendMessage(chatId, storyQuestionText(i, draft.questions.length, q.question), {
      reply_markup: storyQuestionKeyboard(story.id, i, q.options),
    });
  }
  return true;
}

async function runStory(ctx: BotContext, deps: Deps): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;
  const inGroup = chat.type !== "private";
  const room = inGroup
    ? await findRoomByChat(deps.db, chat.id)
    : ctx.user.currentRoomId != null
      ? await getRoom(deps.db, ctx.user.currentRoomId)
      : undefined;
  if (!room) {
    return void (await ctx.reply(inGroup ? "Эта группа ещё не привязана к комнате — отправь /link" : "Сначала создай комнату или вступи в неё — /room"));
  }
  await ctx.reply("📖 Пишу историю из слов комнаты, это около минуты…");
  await ctx.replyWithChatAction("typing");
  try {
    const ok = await publishStory(ctx.api, deps, chat.id, room, inGroup ? undefined : ctx.user.id);
    if (!ok) await ctx.reply(`Для истории нужно хотя бы ${MIN_WORDS} слова в комнате — добавь через /add`);
  } catch (err) {
    console.error("Story failed", err);
    await ctx.reply("Не получилось написать историю 😔 Попробуй ещё раз чуть позже — /story");
  }
}

export function registerStory(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("story", (ctx) => background(ctx, () => runStory(ctx, deps)));

  // Ответ на вопрос — во всплывающем окне, только тому, кто нажал: в группе каждый отвечает сам за себя.
  bot.callbackQuery(/^sq:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const story = cb?.k === "storyAnswer" ? await getStory(deps.db, cb.id) : undefined;
    const q = cb?.k === "storyAnswer" && story ? storyQuestions(story)[cb.q] : undefined;
    if (cb?.k !== "storyAnswer" || !q) return void (await ctx.answerCallbackQuery({ text: "Эта история уже неактуальна" }));
    await ctx.answerCallbackQuery({ text: storyAnswerAlert(q, cb.index), show_alert: true });
  });

  bot.callbackQuery(/^sa:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const story = cb?.k === "storyAudio" ? await getStory(deps.db, cb.id) : undefined;
    if (!story) return void (await ctx.answerCallbackQuery({ text: "Эта история уже неактуальна" }));
    void ctx.answerCallbackQuery(story.audioFileId ? {} : { text: "Озвучиваю…" }).catch(() => {});
    const replyTo = { reply_parameters: { message_id: ctx.callbackQuery.message?.message_id ?? 0, allow_sending_without_reply: true } };
    // Синтез целой истории — секунды: в фоне, чтобы не держать очередь апдейтов.
    background(ctx, async () => {
      let voice: string | InputFile;
      if (story.audioFileId) {
        voice = story.audioFileId;
      } else {
        try {
          const plain = `${story.title}.\n\n${story.body.replace(/\*\*/g, "")}`;
          voice = new InputFile(await deps.speech.synthesize(plain, "uk"), "story.ogg");
        } catch (err) {
          console.error("Story speech failed", story.id, err);
          return void (await ctx.reply("Озвучка недоступна 😔"));
        }
      }
      const message = await ctx.replyWithVoice(voice, replyTo);
      if (!story.audioFileId) await setStoryAudio(deps.db, story.id, message.voice.file_id);
    });
  });
}
