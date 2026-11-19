import type { Bot } from "grammy";
import { disableMeetingPoll, getMeetingPoll, saveMeetingPoll } from "../../services/meeting-polls";
import { parseHHMM } from "../../time";
import { HTML, type BotContext, type Deps } from "../context";
import { esc } from "../texts";

const HELP = [
  "Настройка ежедневного опроса о встрече.",
  "<code>/meetpoll 12:00 Asia/Novosibirsk | 18:00 | 19:30 | Не смогу</code>",
  "Укажи от 2 до 12 разных вариантов через |, до 100 символов каждый. Если пропустить часовой пояс, возьму его из твоих настроек.",
  "Можно выбрать все удобные варианты. Голоса видны участникам.",
  "<code>/meetpoll off</code> — выключить опрос.",
].join("\n");

export function registerMeetingPoll(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("meetpoll", async (ctx) => {
    const { chat, from } = ctx;
    if (chat.type !== "group" && chat.type !== "supergroup") {
      return void (await ctx.reply("Эта команда работает в группе.", HTML));
    }

    const input = ctx.match.trim();
    if (!input) {
      const poll = await getMeetingPoll(deps.db, chat.id);
      const status = poll?.time
        ? `Опрос включён ежедневно в ${esc(poll.time)} (${esc(poll.timezone)}).\nВарианты: ${poll.options.map(esc).join(" | ")}`
        : "Опрос выключен.";
      return void (await ctx.reply(`${status}\n\n${HELP}`, HTML));
    }

    const admins = await ctx.getChatAdministrators().catch(() => null);
    if (!admins) return void (await ctx.reply("Не удалось проверить владельца группы. Попробуй ещё раз.", HTML));
    if (!admins.some((member) => member.status === "creator" && member.user.id === from?.id)) {
      return void (await ctx.reply("Настроить опрос может только владелец группы.", HTML));
    }

    if (input === "off") {
      await disableMeetingPoll(deps.db, chat.id);
      return void (await ctx.reply("Ежедневный опрос выключен.", HTML));
    }

    const [schedule, ...options] = input.split("|").map((part) => part.trim());
    const [clock, zone = ctx.user.timezone, ...extra] = schedule.split(/\s+/);
    const time = parseHHMM(clock);
    if (!time || extra.length || options.length < 2 || options.length > 12
      || options.some((option) => !option || option.length > 100) || new Set(options).size !== options.length) {
      return void (await ctx.reply(HELP, HTML));
    }
    let timezone: string;
    try {
      timezone = new Intl.DateTimeFormat("ru", { timeZone: zone }).resolvedOptions().timeZone;
    } catch {
      return void (await ctx.reply("Проверь часовой пояс. Например, Asia/Novosibirsk или Europe/Moscow.", HTML));
    }

    await saveMeetingPoll(deps.db, chat.id, { time, timezone, options });
    await ctx.reply(`Буду присылать опрос каждый день в ${esc(time)} (${esc(timezone)}).\nВарианты: ${options.map(esc).join(" | ")}`, HTML);
  });
}
