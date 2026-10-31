import type { Bot } from "grammy";
import type { BotContext, Deps } from "../context";
import { HTML } from "../context";
import { listUsers, type UserRow } from "../../services/user-list";
import { esc } from "../texts";

/** Сколько символов в одном сообщении: Telegram режет на 4096, берём с запасом под длинный ник. */
const MAX = 3800;

/** Дата регистрации в ДД.ММ по поясу админа: когда человек пришёл. */
function day(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone }).format(d);
}

function userLine(u: UserRow, timeZone: string): string {
  const handle = u.username ? ` (@${esc(u.username)})` : "";
  const src = u.source ? ` · ${esc(u.source)}` : "";
  return `• <b>${esc(u.firstName)}</b>${handle} — ${u.words} сл., ${u.reviews7d} повт/нед · id ${u.telegramId} · с ${day(u.createdAt, timeZone)}${src}`;
}

/**
 * Строки на человека, уложенные в сообщения до MAX. Шапка только в первом сообщении —
 * в продолжении она лишняя и съедает место.
 */
function pack(rows: UserRow[], timeZone: string): string[] {
  const header = `👥 <b>Пользователи</b> — ${rows.length}\n\n`;
  const lines = rows.map((u) => userLine(u, timeZone));
  const messages: string[] = [];
  let current = "";
  lines.forEach((line, i) => {
    if (current.length > 0 && current.length + 1 + line.length > MAX) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + (i === 0 ? header : "") + line;
  });
  if (current) messages.push(current);
  return messages;
}

/**
 * Команда админа: кто в боте и как активен. Только чтение — править людей из чата нельзя.
 *
 * Аргумент — telegram id или @username: покажет одного человека, а не весь список. Без аргумента —
 * все, новые сверху. Проверка «только админ» здесь, в обработчике: сервисы про настройки бота не знают.
 */
export function registerUsers(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("users", async (ctx) => {
    const admin = deps.adminTelegramId;
    if (!admin || ctx.from?.id !== admin) return void (await ctx.reply("Команда только для админа.", HTML));

    const rows = await listUsers(deps.db, deps.now());
    const argument = ctx.match.trim();
    if (argument) {
      const target = rows.find(
        (u) => String(u.telegramId) === argument || (u.username && `@${u.username}`.toLowerCase() === argument.toLowerCase()),
      );
      if (!target) return void (await ctx.reply(`Никого не нашёл по «${esc(argument)}». Формат: /users 12345 или /users @name`, HTML));
      return void (await ctx.reply(pack([target], ctx.user.timezone)[0], HTML));
    }

    for (const message of pack(rows, ctx.user.timezone)) await ctx.reply(message, HTML);
  });
}
