import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { Bot } from "grammy";
import { deleteWord, getWord } from "../../services/words";
import { updateUser } from "../../services/users";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import { extensionKeyboard } from "../keyboards";
import { esc, extensionText } from "../texts";

/** Папка расширения — для подсказки «Загрузить распакованное». */
const EXTENSION_DIR = resolve("extension");

const newKey = () => randomBytes(18).toString("base64url");

export function registerExtension(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("extension", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Ключ личный — напиши /extension в личку: https://t.me/${deps.botUsername}`));
    if (!deps.capturePort) return void (await ctx.reply("Приём слов из расширения выключен (CAPTURE_PORT=0)"));
    const key = ctx.user.captureKey ?? (await updateUser(deps.db, ctx.user.id, { captureKey: newKey() })).captureKey!;
    await ctx.reply(extensionText(key, EXTENSION_DIR, deps.capturePort), { ...HTML, reply_markup: extensionKeyboard() });
  });

  // Новый ключ — если старый куда-то утёк: прежний сразу перестаёт работать.
  bot.callbackQuery(/^ek$/, async (ctx) => {
    if (!deps.capturePort) return void (await ctx.answerCallbackQuery());
    const user = await updateUser(deps.db, ctx.user.id, { captureKey: newKey() });
    await ctx.answerCallbackQuery({ text: "Новый ключ — вставь его в настройки расширения" });
    await ctx.editMessageText(extensionText(user.captureKey!, EXTENSION_DIR, deps.capturePort), { ...HTML, reply_markup: extensionKeyboard() });
  });

  // «↩️ Отменить» под словом из расширения: удаляет без подтверждения — его только что добавили одним кликом.
  bot.callbackQuery(/^cu:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "captureUndo" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Этого слова уже нет" }));
    if (word.addedBy !== ctx.user.id) return void (await ctx.answerCallbackQuery({ text: "Отменить может только тот, кто добавил" }));
    await deleteWord(deps.db, word.id);
    deps.capture?.forget(ctx.user.id, word.id);
    await ctx.answerCallbackQuery({ text: "Отменено" });
    await ctx.reply(`↩️ Убрал <b>${esc(word.term)}</b>`, HTML);
  });
}
