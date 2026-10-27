import type { Bot } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import { findInlineWords, looksLikeWord } from "../../services/inline";
import { checkAndCount } from "../../services/limits";
import { copyWord, getWord, saveWord } from "../../services/words";
import { ensurePersonalRoom } from "../../services/rooms";
import { encodeCb, decodeCb, fitsCallbackText } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { spendWordQuota } from "./quota";
import { inlineWordDescription, inlineWordText } from "../texts";

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
    // Отмечаем эту попытку последней **сразу**, а не только на пути к модели. Иначе человек, набрав
    // «xyz», стёр его и набрал слово из словаря, всё равно оплатил бы перевод «xyz»: ответ Telegram
    // проигнорирует, а попытка из дневных тридцати уже спишется.
    markPendingInline(ctx.user.id, ctx.inlineQuery.id);

    const hits = query ? await findInlineWords(deps.db, ctx.user.id, query) : [];
    const results: InlineQueryResult[] = hits.map((hit) => ({
      type: "article",
      id: String(hit.word.id),
      title: hit.word.term,
      description: inlineWordDescription(hit.word),
      input_message_content: { message_text: inlineWordText(hit.word), parse_mode: "HTML" },
      // Кнопка живёт уже в отправленном сообщении: нажатие приходит как обычный callback, и там чата нет —
      // только `inline_message_id`, поэтому обработчик `iw:` шлёт подтверждение в личку по `ctx.from.id`.
      reply_markup: {
        inline_keyboard: [[{ text: "➕ В мой словарь", callback_data: encodeCb({ k: "inlineCopy", wordId: hit.word.id }) }]],
      },
    }));

    if (results.length > 0) {
      // cache_time: 0 — словарь человека меняется, а подсказки кэшируются на стороне Telegram.
      await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true });
      return;
    }

    // Нового слова в словарях нет — переводим сам запрос. Без этого человек, впервые увидевший бота,
    // получает «ничего не найдено» ровно на том слове, которое ему нужно, и уходит.
    // Не `await`: ответ уходит в фон, иначе пауза против набора по буквам держала бы весь бот.
    background(ctx, () => answerTranslated(ctx, deps, query, ctx.inlineQuery.id));
  });

  bot.callbackQuery(/^iw:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "inlineCopy" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));

    // У нажатия под инлайн-карточкой чата НЕТ — только `inline_message_id`. Поэтому ни `ctx.chat`,
    // ни `ctx.reply` тут не годятся: подтверждение отправляем человеку в личку по его id.
    // Личный словарь при этом создаётся сам (`ensurePersonalRoom`), заходить в бота для этого не нужно.
    const room = await ensurePersonalRoom(deps.db, ctx.user.id, deps.now());
    const copied = await copyWord(deps.db, { word, toRoomId: room.id, addedBy: ctx.user.id, now: deps.now() });
    if (copied.status === "duplicate") {
      return void (await ctx.answerCallbackQuery({ text: "Уже есть в твоём словаре" }));
    }
    await ctx.answerCallbackQuery({ text: "Добавил ✓" });
    // Карточку повторяем в личке: в чужом чате её показывать не стоит, а человек ждёт подтверждения.
    // Не написать в личку можно (человек не нажимал Start) — тогда молчим, слово уже сохранено.
    await sendCardToUser(ctx, inlineWordText(word));
  });

  // «Добавить в словарь» у перевода, которого не было в базе: слово приходит текстом, переводим заново.
  bot.callbackQuery(/^in:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "inlineCopyNew") return void (await ctx.answerCallbackQuery());

    // Отвечаем сразу и уходим в фон: `enrich` — это обычный перевод с потолком 30 секунд, а апдейты
    // Telegram обрабатываются по одному. Ожидание внутри обработчика заморозило бы бота для всех
    // на это время — то же, что было с инлайн-переводом на каждую букву.
    // Дальше человек узнаёт результат из лички (`sendToUser`), а не из всплывашки.
    await ctx.answerCallbackQuery({ text: "Добавляю…" });
    background(ctx, () => addTranslatedWord(ctx, deps, cb.query));
  });
}

/**
 * Перевести слово из инлайн-кнопки, сохранить его в личный словарь и отчитаться в личку.
 *
 * Работает вне обработки апдейта (см. `background`), поэтому результат человеку виден только в личке:
 * ответить на нажатие второй раз нельзя, `answerCallbackQuery` срабатывает один раз.
 *
 * Переводим заново: между показом подсказки и нажатием кнопки могло пройти время, а хранить показанные
 * переводы между запросами — это кэш, которого пока нет. Зато лимит тратится здесь, а не при нажатии:
 * если человек не нажал, перевода и не было.
 */
async function addTranslatedWord(ctx: BotContext, deps: Deps, query: string): Promise<void> {
  const quota = await checkAndCount(deps.db, {
    userId: ctx.user.id,
    kind: "inline_translate",
    timeZone: ctx.user.timezone,
    now: deps.now(),
  });
  if (!quota.allowed) return void (await sendToUser(ctx, quota.refusal));

  const e = await deps.enricher.enrich(query).catch((err) => {
    console.error("Inline add failed", err);
    return undefined;
  });
  if (!e?.translation) return void (await sendToUser(ctx, "Не получилось перевести, попробуй ещё раз"));

  const term = e.term || query;
  const room = await ensurePersonalRoom(deps.db, ctx.user.id, deps.now());
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
  if (saved.status !== "saved") return void (await sendToUser(ctx, "Уже есть в твоём словаре"));
  // Лимит слов — как у /add и Mini App: слово из инлайна это то же добавление слова.
  await spendWordQuota(deps, { userId: ctx.user.id, timezone: ctx.user.timezone });
  await sendCardToUser(ctx, inlineWordText({ ...e, term }));
}

/** Пауза перед переводом: короче, чем человек набирает слово, но сильно короче бюджета инлайна. */
const INLINE_DEBOUNCE_MS = 700;

/**
 * Последний запрос каждого человека — чтобы отменять устаревшие попытки при наборе по буквам.
 *
 * Инлайн-запрос приходит на каждое нажатие клавиши, и без отмены набор «hello» — это пять переводов
 * и пять списаний из дневного лимита. Каждая попытка перед паузой записывает сюда свой `inline_query.id`
 * и после паузы сверяет: если запись уже не её — человек набрал дальше, и платить не за что.
 */
const pendingInline = new Map<number, string>();

/** Пометить запрос последним. Вызывается в самом начале обработчика, для любого запроса. */
function markPendingInline(userId: number, queryId: string): void {
  pendingInline.set(userId, queryId);
}

/** Всё ещё ли этот запрос последним. Свою запись снимаем: пауза кончилась, хранить её дальше нечего. */
function takePendingInline(userId: number, queryId: string): boolean {
  if (pendingInline.get(userId) !== queryId) return false;
  pendingInline.delete(userId);
  return true;
}

/**
 * Ответ на запрос, которого нет в словарях: подождать, перевести и ответить — или сказать «добавь сам».
 *
 * **Пауза здесь не для красоты.** Инлайн-запрос приходит на каждое нажатие клавиши, и без паузы набор
 * «hello» — это пять запросов к модели, то есть пять списаний из тридцати дневных. Пауза склеивает
 * набор в один запрос: пока человек печатает, предыдущие попытки отменяются.
 *
 * Отменяются они по `pendingInline`, который заполняет сам обработчик: у каждого запроса свой
 * `inline_query.id`, и если к концу паузы он уже не последний — человек набрал дальше, и отвечать на
 * устаревший запрос не нужно. `answerInlineQuery` на устаревший id Telegram всё равно проигнорирует,
 * а вот деньги за перевод уже были бы потрачены.
 *
 * Работа уходит в `background`: обработчик не ждёт модель, иначе на 6 секунд встаёт весь бот —
 * апдейты Telegram обрабатывает по одному (docs/architecture.md, «путь апдейта»).
 */
async function answerTranslated(ctx: BotContext, deps: Deps, query: string, queryId: string): Promise<void> {
  const userId = ctx.user.id;

  // Пустой список Telegram покажет как «Ничего не найдено», поэтому объясняем кнопкой, что делать.
  const empty = async (): Promise<void> => {
    await ctx.answerInlineQuery([], {
      cache_time: 0,
      is_personal: true,
      button: { text: "➕ Добавить слово с переводом", start_parameter: "add" },
    });
  };

  // Мусор и длинный текст не переводим: это не «слово», и модель тут ни при чём.
  if (!query || !looksLikeWord(query) || !deps.enricher.enrichFast) return void (await empty());

  await new Promise((resolve) => setTimeout(resolve, INLINE_DEBOUNCE_MS));
  // Пока ждали, человек набрал ещё — отвечать на этот запрос бессмысленно, а платить за него не нужно.
  if (!takePendingInline(userId, queryId)) return;

  const quota = await checkAndCount(deps.db, {
    userId,
    kind: "inline_translate",
    timeZone: ctx.user.timezone,
    now: deps.now(),
  });
  if (!quota.allowed) return void (await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true }));

  let result: InlineQueryResult | undefined;
  try {
    const e = await deps.enricher.enrichFast(query);
    if (e.translation) {
      const term = e.term || query;
      // id результата уникален в пределах ответа; у нового слова id ещё нет, поэтому берём сам запрос.
      result = {
        type: "article",
        id: `new:${term}`.slice(0, 64),
        title: term,
        description: e.translation,
        input_message_content: { message_text: inlineWordText({ ...e, term }), parse_mode: "HTML" },
        // Кнопку даём только если термин влезает в callback-данные целиком. `encodeCb` обрезал бы его
        // молча, и по нажатию в словарь ушёл бы кусок фразы вместо неё самой — а это уже не то слово,
        // которое человек видел. Длинная фраза показывается как карточка без кнопки: перевести её можно,
        // а «добавить в словарь» — нет, для этого есть /add.
        reply_markup: fitsCallbackText(term)
          ? { inline_keyboard: [[{ text: "➕ Добавить в словарь", callback_data: encodeCb({ k: "inlineCopyNew", query: term }) }]] }
          : undefined,
      };
    }
  } catch (err) {
    // Не успели в потолок или модель отказала — показываем пустоту, а не ошибку.
    console.error("Inline translate failed", err);
  }

  await ctx.answerInlineQuery(result ? [result] : [], { cache_time: 0, is_personal: true });
}

/**
 * Успех: карточка слова с подсказкой, что делать дальше.
 *
 * Именно в личку, а не в чат: нажатие кнопки под инлайн-карточкой приходит без чата, и карточка нужна
 * тому, кто нажал, а не всем в чужом чате.
 */
async function sendCardToUser(ctx: BotContext, text: string): Promise<void> {
  await sendToUser(ctx, `➕ ${text}\n\nВ словаре «Мои слова». Повторить — /learn`);
}

/**
 * Написать человеку в личку. Молча ничего не делает, если написать нельзя.
 *
 * Не написать можно всегда: человек мог ни разу не открывать бота, и Telegram отвечает ошибкой
 * «bot can't initiate conversation». Это не повод падать — при отказе по лимиту или ошибке перевода
 * он просто ничего не увидит, а слово в остальных случаях уже сохранено.
 *
 * `ctx.from` у callback-запроса есть всегда (`ctx.user` из него и собран), но тип grammY допускает
 * undefined — поэтому берём именно id человека, а не чат: чата у инлайн-нажатия нет.
 */
async function sendToUser(ctx: BotContext, text: string): Promise<void> {
  if (!ctx.from) return;
  await ctx.api.sendMessage(ctx.from.id, text, HTML).catch(() => undefined);
}
