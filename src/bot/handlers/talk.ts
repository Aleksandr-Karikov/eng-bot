import { clearPendingInputs, endLongModes } from "../pending";
import type { Bot } from "grammy";
import type { TalkReview } from "../../llm/tutor";
import { getRoom } from "../../services/rooms";
import { storyWords } from "../../services/stories";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { mistakesAskKeyboard, talkEndKeyboard, talkTopicsKeyboard } from "../keyboards";
import { MAX_TALK_TURNS, type Talk } from "../talks";
import { esc, mistakesAskText, talkReviewText } from "../texts";

/** Готовые ситуации: label — на кнопке, topic — для Claude. */
export const TALK_TOPICS = [
  { label: "☕ В кафе", topic: "you are a friendly barista in a cozy cafe, the student is your customer" },
  { label: "🎬 Фильмы и сериалы", topic: "two friends chatting about films and TV shows they have watched recently" },
  { label: "💼 Собеседование", topic: "you interview the student for a job in their own field; ask about their experience" },
  { label: "✈️ Путешествие", topic: "two friends planning a trip abroad together: where, when, budget, what to do" },
  { label: "🏠 Новый сосед", topic: "you are a new neighbour who has just moved in next door and knocks to say hello" },
  { label: "🕵️ Детектив", topic: "you are a detective questioning the student as a witness of a strange incident last night" },
] as const;

/** Сколько слов комнаты подсовывать в разговор. */
const TALK_WORDS = 6;

async function startTalk(ctx: BotContext, deps: Deps, topic: string, label: string): Promise<void> {
  if (!ctx.chat) return;
  const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
  const words = room ? (await storyWords(deps.db, room.id, deps.random, ctx.user.id)).slice(0, TALK_WORDS) : [];
  endLongModes(deps, ctx.user.id, "talk");
  clearPendingInputs(deps, ctx.user.id, ctx.chat.id);
  const talk = deps.talks.start(ctx.user.id, { topic, words, lines: [], chatId: ctx.chat.id });
  const hint = words.length ? `\n\nПопробуй употребить: ${words.map((w) => `<b>${esc(w.term)}</b>`).join(", ")}` : "";
  await ctx.reply(
    `🗣 ${esc(label)}\n\nПиши по-английски, как в обычном чате. По ходу не поправляю — разбор в конце по кнопке «🏁 Закончить».${hint}`,
    HTML,
  );
  await reply(ctx, deps, talk);
}

/** Следующая реплика собеседника. */
async function reply(ctx: BotContext, deps: Deps, talk: Talk): Promise<void> {
  await ctx.replyWithChatAction("typing");
  let line: string;
  try {
    line = await deps.tutor.talkReply(talk);
  } catch (err) {
    console.error("Talk reply failed", err);
    return void (await ctx.reply("Не получилось ответить 😔 Напиши ещё раз или закончи разговор.", { reply_markup: talkEndKeyboard() }));
  }
  talk.lines.push({ who: "bot", text: line });
  deps.talks.touch(talk);
  await ctx.reply(line, { reply_markup: talkEndKeyboard() });
}

async function finishTalk(ctx: BotContext, deps: Deps): Promise<void> {
  const talk = deps.talks.end(ctx.user.id);
  if (!talk) return void (await ctx.reply("Разговор уже закончен. Новый — /talk"));
  if (!talk.lines.some((l) => l.who === "user")) return void (await ctx.reply("Разговор закончен. Новый — /talk"));
  await ctx.reply("🧐 Разбираю разговор…");
  await ctx.replyWithChatAction("typing");
  let review: TalkReview;
  try {
    review = await deps.tutor.talkReview(talk);
  } catch (err) {
    console.error("Talk review failed", err);
    return void (await ctx.reply("Не получилось разобрать разговор 😔 Новый — /talk"));
  }
  const text = talkReviewText(review, talk.words);
  const real = review.fixes.filter((f) => !f.slip);
  if (real.length === 0) return void (await ctx.reply(text, HTML));
  const id = deps.pendingMistakes.create({ authorUserId: ctx.user.id, callerUserId: ctx.user.id, fixes: real, baseText: text });
  await ctx.reply(`${text}\n\n${mistakesAskText(undefined, real.map((f) => f.category ?? ""))}`, { ...HTML, reply_markup: mistakesAskKeyboard(id) });
}

export function registerTalk(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("talk", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Поговорить можно в личке: https://t.me/${deps.botUsername}`));
    const own = ctx.match.trim();
    if (own) return background(ctx, () => startTalk(ctx, deps, own, `Тема: ${own}`));
    await ctx.reply("🗣 О чём поговорим? Выбери ситуацию или напиши свою: /talk спорим, какая пицца лучше", {
      reply_markup: talkTopicsKeyboard(TALK_TOPICS),
    });
  });

  bot.callbackQuery(/^tt:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const choice = cb?.k === "talkTopic" ? TALK_TOPICS[cb.index] : undefined;
    if (!choice) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    background(ctx, () => startTalk(ctx, deps, choice.topic, choice.label));
  });

  bot.callbackQuery(/^te$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    background(ctx, () => finishTalk(ctx, deps));
  });

  // Реплики ученика. Регистрируется перед /add: пока идёт разговор, текст в личке — это ответ, а не новое слово.
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    const talk = deps.talks.get(ctx.user.id);
    if (!talk || text.startsWith("/") || talk.chatId !== ctx.chat.id) return next();
    talk.lines.push({ who: "user", text });
    deps.talks.touch(talk);
    if (talk.lines.filter((l) => l.who === "user").length >= MAX_TALK_TURNS) {
      return background(ctx, async () => {
        await ctx.reply("Отличный длинный разговор! Пора подвести итог 🙂");
        await finishTalk(ctx, deps);
      });
    }
    background(ctx, () => reply(ctx, deps, talk));
  });
}
