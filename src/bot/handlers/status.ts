import type { Bot } from "grammy";
import type { BotContext, BotStatus, Deps } from "../context";
import { HTML } from "../context";

const NAMES: Record<string, string> = {
  "claude-code": "Claude Code (локальный)",
  openrouter: "OpenRouter",
};

const name = (provider: string): string => NAMES[provider] ?? provider;

/** «3 ч 12 мин» — по этому видно, подхватились ли правки без перезапуска. */
function uptime(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} д ${hours % 24} ч`;
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

/**
 * Команда админа: чем бот работает прямо сейчас.
 *
 * Ключи не показываются никогда — только факт «задан». Значения всё равно бесполезны в чате
 * (скопировать из Telegram неудобно), а утечка стоит дорого: переписка хранится в `data/` и уходит
 * в контекст /bug. Текст собирается из `deps.status`, а не из `config`, чтобы показывать то, с чем
 * бот реально запустился, а не то, что лежит в .env сейчас.
 */
export function registerStatus(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("status", async (ctx) => {
    const admin = deps.adminTelegramId;
    if (!admin || ctx.from?.id !== admin) return void (await ctx.reply("Команда только для админа.", HTML));

    const status = deps.status;
    if (!status) return void (await ctx.reply("Состояние тут не собрано — смотри src/index.ts.", HTML));

    // buildStatus возвращает готовый HTML: значения приходят из наших же enum и путей, а не от людей.
    await ctx.reply(render(status, deps.now()), HTML);
  });
}

function render(s: BotStatus, now: Date): string {
  const lines: string[] = [];
  const yes = (ok: boolean): string => (ok ? "да" : "нет");

  lines.push(`<b>Запущен:</b> ${uptime(s.startedAt, now)} назад`);

  lines.push("");
  lines.push("<b>Модель</b>");
  lines.push(`Считает: ${name(s.llm.provider)}`);
  lines.push(`Второй провайдер: ${s.llm.openRouterReady ? "доступен (/llm переключит)" : "не настроен"}`);
  const models = [
    ["основная", s.models.main],
    ["запоминалки", s.models.mnemonic],
    ["проверки", s.models.check],
  ] as const;
  for (const [label, model] of models) {
    if (model) lines.push(`${label}: <code>${model}</code>`);
  }

  lines.push("");
  lines.push("<b>Картинки</b>");
  if (s.images.synth === "off") {
    lines.push("Выключены целиком (IMAGES_ENABLED).");
  } else {
    lines.push(`Рисует: ${s.images.synth === "api" ? `API <code>${s.images.model ?? "?"}</code>` : "локальный FLUX (mflux)"}`);
    // Фон — главный расход на платном API, поэтому про него пишем отдельной строкой и прямо.
    lines.push(`Фоновая генерация: ${s.images.background ? "включена" : "выключена (только по кнопке)"}`);
    lines.push(`Стиль: ${s.images.style}`);
  }

  lines.push("");
  lines.push("<b>Ключи</b>");
  lines.push(`OpenRouter: ${yes(s.secrets.openRouter)}`);
  lines.push(`Рисовалка: ${yes(s.secrets.imageApi)}`);

  lines.push("");
  lines.push("<b>Что установлено</b>");
  lines.push(`Озвучка: ${s.tools.tts}`);
  lines.push(`Распознавание голосовых: ${yes(s.tools.stt)}`);
  lines.push(`Субтитры YouTube: ${yes(s.tools.youtube)}`);
  lines.push(`Частотность слов: ${yes(s.tools.frequency)}`);

  lines.push("");
  lines.push("<b>Снаружи</b>");
  lines.push(`Mini App: ${s.app.port ? `порт ${s.app.port}` : "выключен"}${s.app.urlSet ? ", публичный адрес задан" : ", публичного адреса нет"}`);
  lines.push(`Приём слов из расширения: ${s.app.capturePort ? `порт ${s.app.capturePort}` : "выключен"}`);

  return lines.join("\n");
}
