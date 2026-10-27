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
 * Записать одно добавленное слово в дневной и недельный счётчики.
 *
 * Отдельно от `allowQuota`, потому что добавление слова — двухшаговый путь: сначала черновик, потом
 * подтверждение, и человек вправе передумать. Проверка на входе (`startAdd`) только читает счётчики,
 * а расход идёт здесь — после того, как слово действительно легло в базу. Так отменённый черновик
 * не съедает место, а повторное «это слово уже есть» — тем более.
 *
 * Отказ здесь ничего не пишет и ничего не сообщает: на входе уже ответили, а между проверкой и
 * сохранением человек успел бы израсходовать остаток только в том случае, если бы сам себе мешал.
 */
export async function spendWordQuota(deps: Deps, user: { userId: number; timezone: string }): Promise<void> {
  await checkAndCountWord(deps.db, { userId: user.userId, timeZone: user.timezone, now: deps.now() });
}

