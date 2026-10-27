import type { Bot } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { findInlineWords } from "../../services/inline";
import { copyWord, getWord } from "../../services/words";
import { ensurePersonalRoom, isMember } from "../../services/rooms";
import { encodeCb, decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { inlineWordDescription, inlineWordText } from "../texts";

/** Что показать, когда по запросу ничего не нашлось. */

/**
 * Инлайн-режим: `@бот слово` в любом чате, даже там, где бота нет.
 *
 * Зачем: продукт невидим, пока человек не зайдёт и не принесёт своё слово, а инлайн показывает бота
 * прямо в момент вопроса «что это значит» и оставляет карточку в чужом чате — то есть рекламирует себя
 * без усилий. Этого нет ни у Anki, ни у Duolingo: у них приложение, а инлайн возможен только в Telegram.
 *
 * Три ограничения, определившие устройство:
 * 1. **Ответ нужен за ~10 секунд**, иначе Telegram просто не покажет подсказки. Поэтому здесь только
 *    поиск по уже переведённым словам и **ни одного вызова модели** (см. `findInlineWords`).
 * 2. **Чужой чат.** Карточка уходит людям, которые бота не знают, поэтому в ней нет ни комнат, ни
 *    прогресса, ни настроек — только слово, перевод и одна кнопка.
 * 3. **Картинку инлайн отдаёт только ссылкой** (`photo_url`), а не файлом. Публичного URL у наших
 *    картинок нет, поэтому в подсказке текст; картинка появится уже в личке при повторении.
 */
export function registerInline(bot: Bot<BotContext>, deps: Deps): void {
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const hits = query ? await findInlineWords(deps.db, ctx.user.id, query) : [];

    if (hits.length === 0) {
      // Пустой список Telegram покажет как «Ничего не найдено», поэтому объясняем кнопкой, что делать.
      await ctx.answerInlineQuery([], {
        cache_time: 0,
        is_personal: true,
        button: { text: "➕ Добавить слово с переводом", start_parameter: "add" },
      });
      return;
    }

    const results: InlineQueryResult[] = hits.map((hit) => ({
      type: "article",
      id: String(hit.word.id),
      title: hit.word.term,
      description: inlineWordDescription(hit.word),
      input_message_content: { message_text: inlineWordText(hit.word), parse_mode: "HTML" },
      // Кнопка живёт уже в отправленном сообщении: нажатие приходит как обычный callback, и там чат есть.
      reply_markup: {
        inline_keyboard: [[{ text: "➕ В мой словарь", callback_data: encodeCb({ k: "inlineCopy", wordId: hit.word.id }) }]],
      },
    }));

    // cache_time: 0 — словарь человека меняется, а подсказки кэшируются на стороне Telegram.
    await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
  });

  bot.callbackQuery(/^iw:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "inlineCopy" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));

    // Кнопку могли нажать в чужом чате: копируем в личный словарь того, кто нажал, а не в комнату чата.
    if (!ctx.chat) return void (await ctx.answerCallbackQuery({ text: "Открой бота в личке и нажми Start" }));
    const room = await ensurePersonalRoom(deps.db, ctx.user.id, deps.now());
    const copied = await copyWord(deps.db, { word, toRoomId: room.id, addedBy: ctx.user.id, now: deps.now() });
    if (copied.status === "duplicate") {
      return void (await ctx.answerCallbackQuery({ text: "Уже есть в твоём словаре" }));
    }
    await ctx.answerCallbackQuery({ text: "Добавил ✓" });
    // Карточку повторяем в личке: в чужом чате её показывать не стоит, а человек ждёт подтверждения.
    await ctx.reply(`➕ ${inlineWordText(word)}\n\nВ словаре «Мои слова». Повторить — /learn`, HTML).catch(() => undefined);
  });
}
