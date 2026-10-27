import { checkAndCount, type QuotaKind } from "../../services/limits";
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
