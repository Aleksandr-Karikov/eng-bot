import type { Word } from "../db/schema";
import { listRoomWords } from "../services/words";
import { HTML, type BotContext, type Deps } from "./context";
import type { Picker } from "./pickers";
import { pickerKeyboard } from "./keyboards";
import { esc } from "./texts";
import { resolveRoom } from "./word-flow";

const HEADS: Record<Picker["action"], string> = { delete: "🗑 Что удалить?", edit: "✏️ Что исправить?" };

/**
 * Находит слово для /delete или /edit: по кусочку или списком последних.
 * Если по кусочку нашлось ровно одно — сразу вызывает onSingle.
 */
export async function pickWord(
  ctx: BotContext,
  deps: Deps,
  fragment: string,
  action: Picker["action"],
  onSingle: (word: Word) => Promise<void>,
): Promise<void> {
  const room = await resolveRoom(ctx, deps);
  if (!room) return;
  const found = await listRoomWords(deps.db, room.id, fragment);
  if (found.length === 0) {
    return void (await ctx.reply(fragment ? `Не нашёл «${esc(fragment)}» в комнате` : "В комнате пока нет слов", HTML));
  }
  if (fragment && found.length === 1) return onSingle(found[0]);
  const picker = deps.pickers.create(
    ctx.user.id,
    found.map((w) => ({ wordId: w.id, label: `${w.term} — ${w.translation}` })),
    action,
  );
  const head = fragment ? `Нашёл ${found.length} с «${esc(fragment)}»` : "Последние добавленные сверху";
  await ctx.reply(`${HEADS[action]} ${head}:`, { ...HTML, reply_markup: pickerKeyboard(picker) });
}
