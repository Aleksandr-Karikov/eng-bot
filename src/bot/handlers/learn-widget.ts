import { readFileSync } from "node:fs";
import type { Bot, Context, MiddlewareFn } from "grammy";
import type { Chat, User } from "grammy/types";
import { State } from "ts-fsrs";
import { answerCard, nextDue } from "../../services/review";
import type { Answer } from "../../srs/srs";
import type { DueItem } from "../../services/review";
import { transcriptionLine } from "../texts";
import type { BotContext, Deps } from "../context";

/**
 * /learnnew — проба виджетов Bot API 10.4: вся сессия /learn в одном сообщении. Пока только карточка
 * EN → RU и только у админа; обычный /learn не тронут.
 */
export const LEARN_WIDGET_HTML = readFileSync(new URL("../widgets/learn.html", import.meta.url), "utf8");

/** Сколько байт данных виджета принимает Telegram. */
export const WIDGET_DATA_LIMIT = 1024;

interface WidgetQuery {
  id: string;
  from: User;
  chat?: Chat;
  message_id?: number;
  data: string;
}

type Raw = Record<string, (payload: Record<string, unknown>) => Promise<unknown>>;
// shortcut: в grammY ещё нет методов виджетов — зовём их по имени через raw; убрать, когда появятся типы.
const raw = (ctx: Context): Raw => ctx.api.raw as unknown as Raw;

const widgetQuery = (ctx: Context): WidgetQuery | undefined => (ctx.update as { widget_query?: WidgetQuery }).widget_query;

/**
 * grammY не знает widget_query, и ctx.from / ctx.chat у него пустые — без них userMiddleware не найдёт ни
 * человека, ни язык комнаты. Ставить до userMiddleware.
 */
export const widgetQueryContext: MiddlewareFn<BotContext> = (ctx, next) => {
  const q = widgetQuery(ctx);
  if (q) {
    Object.defineProperty(ctx, "from", { value: q.from });
    Object.defineProperty(ctx, "chat", { value: q.chat });
  }
  return next();
};

/** Данные карточки для виджета, не длиннее лимита: длинный пример выкидываем, перевод режем. */
export function cardData(item: DueItem | undefined, answered: number): string {
  if (!item) return JSON.stringify({ done: true, n: answered });
  const { card, word } = item;
  const data = {
    c: card.id,
    r: card.reps,
    t: word.term,
    s: transcriptionLine(word),
    e: word.example,
    a: word.translation,
    new: card.state === State.New ? 1 : 0,
    n: answered,
  };
  const size = () => Buffer.byteLength(JSON.stringify(data));
  if (size() > WIDGET_DATA_LIMIT) data.e = "";
  while (size() > WIDGET_DATA_LIMIT) data.a = data.a.slice(0, -10);
  return JSON.stringify(data);
}

const ANSWERS = new Set<Answer>(["again", "good", "easy"]);

export function registerLearnWidget(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("learnnew", async (ctx) => {
    if (!deps.adminTelegramId || ctx.from?.id !== deps.adminTelegramId) return void (await ctx.reply("Команда только для админа."));
    if (ctx.chat.type !== "private") return void (await ctx.reply("Виджеты пока работают только в личке с ботом."));
    await raw(ctx).sendWidget({
      chat_id: ctx.chat.id,
      html: LEARN_WIDGET_HTML,
      chat_data: cardData(await nextDue(deps.db, ctx.user.id, deps.now()), 0),
      allow_queries: true,
      caption: "Не видно карточку — обнови Telegram или учи в /learn",
    });
  });

  bot.use(async (ctx, next) => {
    const q = widgetQuery(ctx);
    if (!q) return next();
    // data приходит от клиента: «карточка:повторения:оценка:сколько ответил».
    const [cardId, reps, answer, answered] = q.data.split(":");
    const n = Number(answered) || 0;
    try {
      if (ANSWERS.has(answer as Answer) && q.chat && q.message_id) {
        const now = deps.now();
        const res = await answerCard(deps.db, { userId: ctx.user.id, cardId: Number(cardId), expectedReps: Number(reps), answer: answer as Answer, now });
        const next = await nextDue(deps.db, ctx.user.id, now);
        await raw(ctx).editMessageWidgetData({ chat_id: q.chat.id, message_id: q.message_id, chat_data: cardData(next, res === "ok" ? n + 1 : n) });
      }
    } finally {
      // Без ответа за 15 с виджет покажет ошибку — отвечаем и когда правка не удалась.
      await raw(ctx).answerWidgetQuery({ widget_query_id: q.id });
    }
  });
}
