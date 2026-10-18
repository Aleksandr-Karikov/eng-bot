import type { Bot } from "grammy";
import type { SayAnswer } from "../../llm/tutor";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { sayKeyboard } from "../keyboards";
import { sayText } from "../texts";
import { commandInput } from "../word-flow";
import { startAdd } from "./add";

const USAGE = "Напиши фразу после команды: /say неудобно получилось\nИли ответь командой /say на сообщение.";
const MAX_PHRASE = 500;
/** Ответы /say для кнопок «➕» — последние, в памяти. */
const KEEP = 200;
const answers = new Map<number, SayAnswer>();
let seq = 0;

async function runSay(ctx: BotContext, deps: Deps, phrase: string): Promise<void> {
  if (!phrase) return void (await ctx.reply(USAGE));
  if (phrase.length > MAX_PHRASE) return void (await ctx.reply(`Слишком длинно — пришли до ${MAX_PHRASE} символов`));
  await ctx.replyWithChatAction("typing");
  let answer: SayAnswer;
  try {
    answer = await deps.tutor.say(phrase);
  } catch (err) {
    console.error("Say failed", err);
    return void (await ctx.reply("Не получилось подобрать варианты 😔 Попробуй ещё раз чуть позже"));
  }
  const id = ++seq;
  answers.set(id, answer);
  answers.delete(id - KEEP);
  await ctx.reply(sayText(phrase, answer), {
    ...HTML,
    reply_parameters: { message_id: ctx.message?.message_id ?? 0, allow_sending_without_reply: true },
    reply_markup: answer.learn.length ? sayKeyboard(id, answer.learn) : undefined,
  });
}

export function registerSay(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("say", (ctx) => background(ctx, () => runSay(ctx, deps, commandInput(ctx))));

  bot.callbackQuery(/^sy:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const item = cb?.k === "sayAdd" ? answers.get(cb.id)?.learn[cb.index] : undefined;
    if (!item) return void (await ctx.answerCallbackQuery({ text: "Это уже неактуально — повтори /say" }));
    await ctx.answerCallbackQuery();
    background(ctx, () => startAdd(ctx, deps, `${item.term} — ${item.translation}`));
  });
}
