import { checkAndCount, checkAndCountWord, type QuotaKind } from "../../services/limits";
import { HTML, type BotContext, type Deps } from "../context";

/**
 * Общий вход для лимитов тяжёлых команд: проверить, а при отказе — сказать и вернуть false.
 *
 * Зачем отдельная функция, а не `checkAndCount` в каждом обработчике: обработчиков восемь, и в каждом
 * пришлось бы повторить ответ человеку, `return void` и приведение `ctx.user`. Здесь это написано один
 * раз, а обработчик остаётся одной строкой — «можно? нет — выходим».
 *
 * Telegram-слой, поэтому SQL тут нет: считает `checkAndCount` в сервисе.
 *
 * **Считается попытка, а не успех.** Отказ ничего не пишет (см. `limits.ts`), а вот ошибка модели —
 * пишет: иначе сбой внешнего API давал бы неограниченные повторы. Осознанный размен: человек вправе
 * попросить ещё раз, и это будет стоить ему одной попытки.
 */
export async function allowQuota(ctx: BotContext, deps: Deps, kind: QuotaKind): Promise<boolean> {
  const state = await checkAndCount(deps.db, {
    userId: ctx.user.id,
    kind,
    timeZone: ctx.user.timezone,
    now: deps.now(),
  });
  if (state.allowed) return true;
  await ctx.reply(state.refusal, HTML);
  return false;
}

/**
 * Списать место в лимите слов — **до** сохранения слова, а не после.
 *
 * Возвращает `false`, если места нет: вызывающий обязан в этом случае не сохранять слово и сказать
 * человеку причину. Раньше функция возвращала `void` и звалась уже после `saveWord`, поэтому её отказ
 * ничего не останавливал: слово оставалось в базе, а счётчик мог быть уже за пределом (E25). Проверка
 * на входе (`startAdd`) этого не закрывает — между черновиком и подтверждением проходит время, и место
 * мог забрать другой путь (инлайн, второй телефон).
 *
 * Почему не «списать после успешного сохранения»: тогда отказ приходил бы уже после записи, и
 * единственным способом не превысить лимит было бы удалять слово обратно — то есть откатывать
 * операцию, которую человек считает выполненной. Порядок «сначала место, потом слово» — тот же, что
 * в пачке `/text` (см. `saveItems`).
 */
export async function spendWordQuota(deps: Deps, user: { userId: number; timezone: string }): Promise<boolean> {
  const state = await checkAndCountWord(deps.db, { userId: user.userId, timeZone: user.timezone, now: deps.now() });
  return state.allowed;
}

