import type { Bot } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { findInlineWords, looksLikeWord } from "../../services/inline";
import { checkAndCount } from "../../services/limits";
import { copyWord, getWord, saveWord } from "../../services/words";
import { ensurePersonalRoom } from "../../services/rooms";
import { encodeCb, decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { esc, inlineWordDescription, inlineWordText } from "../texts";

/**
 * Инлайн-режим: `@бот слово` в любом чате, даже там, где бота нет.
 *
 * Зачем: продукт невидим, пока человек не зайдёт и не принесёт своё слово, а инлайн показывает бота
 * прямо в момент вопроса «что это значит» и оставляет карточку в чужом чате — то есть рекламирует себя
 * без усилий. Этого нет ни у Anki, ни у Duolingo: у них приложение, а инлайн возможен только в Telegram.
 *
 * Устройство определяют три ограничения:
 * 1. **Ответ нужен за ~10 секунд**, иначе Telegram просто не показывает подсказки. Поэтому сначала ищем
 *    по уже переведённым словам (мгновенно), и только если не нашли — просим модель перевести сам запрос.
 *    Замер: перевод одного слова занимает 0.9–1.3 с (docs/llm-models.md), то есть в бюджет укладывается;
 *    на всякий случай потолок жёстко ограничен (`enrichFast`, 6 с).
 * 2. **Чужой чат.** Карточка уходит людям, которые бота не знают, поэтому в ней нет ни комнат, ни
 *    прогресса, ни настроек — только слово, перевод и одна кнопка.
 * 3. **Картинку инлайн отдаёт только ссылкой** (`photo_url`), а не файлом. Публичного URL у наших
 *    картинок нет, поэтому в подсказке текст; картинка появится уже в личке при повторении.
 */
export function registerInline(bot: Bot<BotContext>, deps: Deps): void {
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    const hits = query ? await findInlineWords(deps.db, ctx.user.id, query) : [];
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

    // Нового слова в словарях нет — переводим сам запрос. Без этого человек, впервые увидевший бота,
    // получает «ничего не найдено» ровно на том слове, которое ему нужно, и уходит.
    const fresh = await translateFresh(ctx, deps, query, hits.length);
    if (fresh) results.unshift(fresh);

    if (results.length === 0) {
      // Пустой список Telegram покажет как «Ничего не найдено», поэтому объясняем кнопкой, что делать.
      await ctx.answerInlineQuery([], {
        cache_time: 0,
        is_personal: true,
        button: { text: "➕ Добавить слово с переводом", start_parameter: "add" },
      });
      return;
    }

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

  // «Добавить в словарь» у перевода, которого не было в базе: слово приходит текстом, переводим заново.
  bot.callbackQuery(/^in:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "inlineCopyNew") return void (await ctx.answerCallbackQuery());

    // Личного словаря может не быть вовсе: человек нажал кнопку прямо в чужом чате, ни разу не открыв
    // бота. Тогда сохранять некуда — ведём в личку, где личный словарь создаётся при первом заходе.
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return void (await ctx.reply(
        `Слово «${esc(cb.query)}» положу в личный словарь — открой меня в личке и нажми Start.`,
        HTML,
      ).catch(() => undefined));
    }

    const room = await ensurePersonalRoom(deps.db, ctx.user.id, deps.now());
    // Переводим заново: между показом подсказки и нажатием кнопки могло пройти время, а хранить
    // показанные переводы между запросами — это кэш, которого пока нет.
    const e = await deps.enricher.enrich(cb.query).catch((err) => {
      console.error("Inline add failed", err);
      return undefined;
    });
    if (!e?.translation) return void (await ctx.answerCallbackQuery({ text: "Не получилось перевести, попробуй ещё раз" }));

    const term = e.term || cb.query;
    const saved = await saveWord(deps.db, {
      roomId: room.id,
      addedBy: ctx.user.id,
      now: deps.now(),
      draft: {
        term,
        translation: e.translation,
        explanation: e.explanation ?? "",
        example: e.example ?? "",
        transcriptionUk: e.transcriptionUk ?? "",
        transcriptionUs: e.transcriptionUs ?? "",
      },
    });
    if (saved.status !== "saved") return void (await ctx.answerCallbackQuery({ text: "Уже есть в твоём словаре" }));
    await ctx.answerCallbackQuery({ text: "Добавил ✓" });
    await ctx.reply(`➕ ${inlineWordText({ ...e, term })}\n\nВ словаре «Мои слова». Повторить — /learn`, HTML);
  });
}

/**
 * Перевести сам запрос, если в словарях его нет.
 *
 * Лимит тратится **только на фактический вызов модели**: когда слово нашлось в словаре, расхода нет,
 * и списывать за это квоту было бы нечестно. Модель здесь доступна незнакомому человеку в чужом чате,
 * поэтому проверка обязательна — иначе `@бот` превращается в бесплатный доступ к ключу.
 *
 * Ничего не сохраняем: перевод показывается, а добавляет человек сам кнопкой. Иначе любой, кто набрал
 * `@бот` в чужом чате, молча набивал бы себе словарь (и нагружал базу) без единого действия.
 */
async function translateFresh(
  ctx: BotContext,
  deps: Deps,
  query: string,
  found: number,
): Promise<InlineQueryResult | undefined> {
  // Уже есть что показать — модель не нужна.
  if (found > 0 || !query || !looksLikeWord(query)) return undefined;
  if (!deps.enricher.enrichFast) return undefined;

  const quota = await checkAndCount(deps.db, {
    userId: ctx.user.id,
    kind: "inline_translate",
    timeZone: ctx.user.timezone,
    now: deps.now(),
  });
  if (!quota.allowed) return undefined;

  try {
    const e = await deps.enricher.enrichFast(query);
    if (!e.translation) return undefined;
    const term = e.term || query;
    // id результата уникален в пределах ответа; у нового слова id ещё нет, поэтому берём сам запрос.
    return {
      type: "article",
      id: `new:${term}`.slice(0, 64),
      title: term,
      description: e.translation,
      input_message_content: { message_text: inlineWordText({ ...e, term }), parse_mode: "HTML" },
      reply_markup: {
        inline_keyboard: [[{ text: "➕ Добавить в словарь", callback_data: encodeCb({ k: "inlineCopyNew", query: term }) }]],
      },
    };
  } catch (err) {
    // Не успели в потолок или модель отказала — показываем найденное, а не пустоту и не ошибку.
    console.error("Inline translate failed", err);
    return undefined;
  }
}
