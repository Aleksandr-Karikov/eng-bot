import type { Bot } from "grammy";
import type { User, Word } from "../../db/schema";
import { isMember } from "../../services/rooms";
import { deleteWord, getWord, listRoomWords } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { confirmBatchDeleteKeyboard, confirmDeleteKeyboard, pickerKeyboard, pickerPageCount } from "../keyboards";
import { esc, plural } from "../texts";
import { resolveRoom } from "../word-flow";

/** Удалять может любой участник комнаты, где лежит слово. */
const canDelete = (deps: Deps, user: User, word: Word) => isMember(deps.db, word.roomId, user.id);

async function askConfirm(ctx: BotContext, word: Word): Promise<void> {
  await ctx.reply(
    `Удалить для всех <b>${esc(word.term)}</b> — ${esc(word.translation)}?\nКарточки и прогресс по нему пропадут у всех участников.`,
    { ...HTML, reply_markup: confirmDeleteKeyboard(word.id) },
  );
}

async function startDelete(ctx: BotContext, deps: Deps, fragment: string): Promise<void> {
  const room = await resolveRoom(ctx, deps);
  if (!room) return;
  const found = await listRoomWords(deps.db, room.id, fragment);
  if (found.length === 0) {
    return void (await ctx.reply(fragment ? `Не нашёл «${esc(fragment)}» в комнате` : "В комнате пока нет слов", HTML));
  }
  if (fragment && found.length === 1) return askConfirm(ctx, found[0]);
  const picker = deps.pickers.create(
    ctx.user.id,
    found.map((w) => ({ wordId: w.id, label: `${w.term} — ${w.translation}` })),
  );
  const head = fragment ? `Нашёл ${found.length} с «${esc(fragment)}»` : "Последние добавленные сверху";
  await ctx.reply(`🗑 Что удалить? ${head}:`, { ...HTML, reply_markup: pickerKeyboard(picker) });
}

export function registerDelete(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("delete", (ctx) => background(ctx, () => startDelete(ctx, deps, ctx.match.trim())));

  bot.callbackQuery(/^x:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "del" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (!(await canDelete(deps, ctx.user, word))) return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    await ctx.answerCallbackQuery();
    await askConfirm(ctx, word);
  });

  bot.callbackQuery(/^xo:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "delOk" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Это слово уже удалили" }));
    if (!(await canDelete(deps, ctx.user, word))) return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    await deleteWord(deps.db, word.id);
    await ctx.answerCallbackQuery({ text: "Удалено" });
    const hint = ctx.chat?.type === "private" ? "\nЕсли ты был в /learn — нажми /learn, чтобы продолжить." : "";
    await ctx.editMessageText(`🗑 Удалено: <b>${esc(word.term)}</b>${hint}`, HTML);
  });

  bot.callbackQuery(/^xc$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Ок, оставил 👌");
  });

  bot.callbackQuery(/^xb:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "delBatch" ? deps.batches.get(cb.id) : undefined;
    if (!batch) return void (await ctx.answerCallbackQuery({ text: "Пачка уже неактуальна — удали слова через /delete" }));
    if (!(await isMember(deps.db, batch.roomId, ctx.user.id))) return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    await ctx.answerCallbackQuery();
    const n = batch.saved.length;
    await ctx.reply(`Удалить для всех ${n} ${plural(n, "слово", "слова", "слов")} из этой пачки?`, {
      reply_markup: confirmBatchDeleteKeyboard(batch.id),
    });
  });

  bot.callbackQuery(/^xbo:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const batch = cb?.k === "delBatchOk" ? deps.batches.get(cb.id) : undefined;
    if (!batch) return void (await ctx.answerCallbackQuery({ text: "Пачка уже неактуальна — удали слова через /delete" }));
    if (!(await isMember(deps.db, batch.roomId, ctx.user.id))) return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    let deleted = 0;
    for (const word of batch.saved) if (await deleteWord(deps.db, word.id)) deleted++;
    deps.batches.delete(batch.id);
    await ctx.answerCallbackQuery({ text: "Удалено" });
    await ctx.editMessageText(`🗑 Удалено: ${deleted}`);
  });

  bot.callbackQuery(/^xp:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const picker = cb?.k === "delPage" ? deps.pickers.get(cb.id) : undefined;
    if (cb?.k !== "delPage" || !picker || picker.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Этот список уже неактуален — отправь /delete ещё раз" }));
    }
    await ctx.answerCallbackQuery();
    if (cb.page === picker.page || cb.page < 0 || cb.page >= pickerPageCount(picker)) return;
    picker.page = cb.page;
    await ctx.editMessageReplyMarkup({ reply_markup: pickerKeyboard(picker) });
  });
}
