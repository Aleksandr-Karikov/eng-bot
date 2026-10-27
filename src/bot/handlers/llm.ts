import type { Bot } from "grammy";
import type { BotContext, Deps } from "../context";
import { HTML } from "../context";
import { esc } from "../texts";

/** Как провайдер называется для человека: в логах и .env — имена технические. */
const NAMES: Record<string, string> = {
  "claude-code": "Claude Code (локальный)",
  openrouter: "OpenRouter",
};

const USAGE =
  "Смена модели, на которой работает бот.\n" +
  "/llm — какой провайдер сейчас.\n" +
  "/llm openrouter — считать через OpenRouter (нужны OPEN_ROUTER_API_KEY и OPENROUTER_MODEL).\n" +
  "/llm claude-code — вернуться на локальный Claude Code.\n\n" +
  "Переключение мгновенное: перезапускать бота не нужно, уже начатые запросы доработают на прежнем провайдере.";

const name = (provider: string): string => NAMES[provider] ?? provider;

/**
 * Команда админа: чем бот думает прямо сейчас. Смысл — проверить OpenRouter вживую, не трогая .env
 * и не перезапуская бота; выбор переживает перезапуск (его хранит `src/llm/provider-store.ts`).
 *
 * Нужна именно команда, а не только скрипт: чаще всего переключиться хочется ровно тогда, когда
 * видно, что модель не справляется, — то есть из чата.
 */
export function registerLlm(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("llm", async (ctx) => {
    // Команда только для админа: она меняет поведение бота для всех и стоит денег на OpenRouter.
    const admin = deps.adminTelegramId;
    if (!admin || ctx.from?.id !== admin) return void (await ctx.reply("Команда только для админа.", HTML));

    const llm = deps.llm;
    if (!llm) return void (await ctx.reply("Смена провайдера тут не собрана — смотри src/index.ts.", HTML));

    const argument = ctx.match.trim().toLowerCase();
    if (!argument) return void (await ctx.reply(status(llm), HTML));
    if (argument !== "claude-code" && argument !== "openrouter") {
      // Аргумент — текст от человека, а сообщение уходит как HTML: без esc() он сломает разметку.
      return void (await ctx.reply(`Не знаю провайдера «${esc(argument)}».\n\n${USAGE}`, HTML));
    }

    try {
      const previous = llm.use(argument);
      const lines = [`✅ Считаю через ${name(argument)}.`];
      if (previous !== argument) lines.push(`Было: ${name(previous)}.`);
      await ctx.reply(lines.join("\n"), HTML);
    } catch (err) {
      // Ошибку показываем как есть: в ней написано, каких переменных не хватает.
      await ctx.reply(`Не вышло: ${esc(err instanceof Error ? err.message : String(err))}`, HTML);
    }
  });
}

function status(llm: NonNullable<Deps["llm"]>): string {
  const lines = [`Сейчас: ${name(llm.provider)}.`];
  lines.push(
    llm.openRouterReady
      ? "OpenRouter доступен — /llm openrouter переключит."
      : "OpenRouter не настроен: в .env нет OPEN_ROUTER_API_KEY или OPENROUTER_MODEL.",
  );
  return lines.join("\n");
}
