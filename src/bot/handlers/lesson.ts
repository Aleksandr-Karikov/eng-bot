import { InputFile, type Api, type Bot } from "grammy";
import type { User } from "../../db/schema";
import { buildLesson, lessonWords } from "../../speech/lesson";
import { background, type BotContext, type Deps } from "../context";

/** Урок собирается с минуту — второй, пока идёт первый, не начинаем. */
const building = new Set<number>();

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/**
 * 🎧 Аудиоурок в личку: mp3 со словами, которые человек учит (слабые — первыми). Telegram играет его в фоне,
 * с погасшим экраном — как подкаст. false — урок уже собирается или слушать пока нечего (тогда — сообщение).
 */
export async function sendLesson(deps: Deps, api: Api, user: User): Promise<"started" | "busy" | "empty"> {
  if (building.has(user.id)) return "busy";
  const list = await lessonWords(deps.db, user.id);
  if (list.length === 0) {
    await api.sendMessage(user.telegramId, "🎧 Пока нечего слушать — сначала начни учить слова в /learn.");
    return "empty";
  }
  building.add(user.id);
  void (async () => {
    try {
      const audio = await buildLesson(deps.speech, list);
      const now = deps.now();
      const title = `Аудиоурок ${now.getDate()} ${MONTHS[now.getMonth()]} · ${list.length} слов`;
      const names = list.map((w) => w.term).join(", ");
      await api.sendAudio(user.telegramId, new InputFile(audio, "wordboss-lesson.mp3"), {
        title,
        performer: "WordBoss",
        caption: `🎧 ${list.length} слов, которые держатся слабее всего: ${names}`.slice(0, 1000),
      });
    } catch (err) {
      console.error("Lesson failed", err);
      await api.sendMessage(user.telegramId, "Не получилось собрать аудиоурок 😔 Попробуй ещё раз — /audio").catch(() => {});
    } finally {
      building.delete(user.id);
    }
  })();
  return "started";
}

export function registerLesson(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("audio", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Аудиоурок приходит в личку: https://t.me/${deps.botUsername}`));
    background(ctx, async () => {
      const status = await sendLesson(deps, ctx.api, ctx.user);
      if (status === "busy") await ctx.reply("🎧 Уже собираю урок — пришлю, как будет готов.");
      if (status === "started") await ctx.reply("🎧 Собираю аудиоурок — минута-две. Его можно слушать в фоне, с погасшим экраном.");
    });
  });
}
