import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { InputFile, type Bot } from "grammy";
import { deleteWord, getWord } from "../../services/words";
import { updateUser } from "../../services/users";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { extensionKeyboard } from "../keyboards";
import { esc, extensionText } from "../texts";

/** Папка расширения — для подсказки «Загрузить распакованное». */
const EXTENSION_DIR = resolve("extension");

const newKey = () => randomBytes(18).toString("base64url");
const run = promisify(execFile);

function extensionVersion(): string {
  return (JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8")) as { version: string }).version;
}

/** Zip папки расширения (системный zip, без shell); временная папка удаляется. */
/** Архив расширения с уже вписанными ключом и адресом (preset.json) — после установки ничего настраивать не нужно. */
async function packExtension(preset: { key: string; server: string }): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "eng-bot-ext-"));
  try {
    const src = join(dir, "wordboss");
    await cp(EXTENSION_DIR, src, { recursive: true, filter: (path) => !/(^|\/)\.[^/]*$/.test(path.slice(EXTENSION_DIR.length)) });
    await writeFile(join(src, "preset.json"), JSON.stringify(preset));
    const out = join(dir, "extension.zip");
    await run("zip", ["-qr", out, "wordboss"], { cwd: dir, timeout: 30_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Куда расширению слать слова: если приложение открыто наружу (ngrok по APP_URL), сервер приложения
 * пробрасывает /ext на сервер расширения — работает с любого компьютера; иначе только localhost.
 */
function extensionServer(deps: Deps): string {
  return deps.appUrl ? `${new URL(deps.appUrl).origin}/ext` : `http://localhost:${deps.capturePort}`;
}

export function registerExtension(bot: Bot<BotContext>, deps: Deps): void {
  // Mini App с карточками: кнопка открывает его прямо в Telegram (работает только в личке).
  bot.command("app", async (ctx) => {
    if (!deps.appUrl) return void (await ctx.reply("Приложение с карточками пока не включено (APP_URL)"));
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Приложение открывается в личке: https://t.me/${deps.botUsername}`));
    await ctx.reply("📚 Карточки со свайпами: вправо — помню, влево — забыл.", {
      reply_markup: { inline_keyboard: [[{ text: "📚 Открыть карточки", web_app: { url: deps.appUrl } }]] },
    });
  });

  bot.command("extension", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Ключ личный — напиши /extension в личку: https://t.me/${deps.botUsername}`));
    if (!deps.capturePort) return void (await ctx.reply("Приём слов из расширения выключен (CAPTURE_PORT=0)"));
    const key = ctx.user.captureKey ?? (await updateUser(deps.db, ctx.user.id, { captureKey: newKey() })).captureKey!;
    await ctx.reply(extensionText(key, extensionServer(deps)), { ...HTML, reply_markup: extensionKeyboard() });
  });

  // Архив расширения прямо в чат — не нужно пересылать файлы вручную. Собирается из папки extension/, всегда свежий.
  bot.callbackQuery(/^ez$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Упаковываю…" });
    background(ctx, async () => {
      let zip: Buffer;
      try {
        const key = ctx.user.captureKey ?? (await updateUser(deps.db, ctx.user.id, { captureKey: newKey() })).captureKey!;
        zip = await packExtension({ key, server: extensionServer(deps) });
      } catch (err) {
        console.error("Extension zip failed", err);
        return void (await ctx.reply("Не получилось упаковать расширение 😔"));
      }
      await ctx.replyWithDocument(new InputFile(zip, `wordboss-extension-${extensionVersion()}.zip`), {
        caption: "Распакуй архив → chrome://extensions → «Режим разработчика» → «Загрузить распакованное» → выбери папку wordboss. Ключ и адрес уже внутри — настраивать ничего не надо. Архив личный, не пересылай его.",
      });
    });
  });

  // Новый ключ — если старый куда-то утёк: прежний сразу перестаёт работать.
  bot.callbackQuery(/^ek$/, async (ctx) => {
    if (!deps.capturePort) return void (await ctx.answerCallbackQuery());
    const user = await updateUser(deps.db, ctx.user.id, { captureKey: newKey() });
    await ctx.answerCallbackQuery({ text: "Новый ключ — вставь его в настройки расширения" });
    await ctx.editMessageText(extensionText(user.captureKey!, extensionServer(deps)), { ...HTML, reply_markup: extensionKeyboard() });
  });

  // «↩️ Отменить» под словом из расширения: удаляет без подтверждения — его только что добавили одним кликом.
  bot.callbackQuery(/^cu:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const word = cb?.k === "captureUndo" ? await getWord(deps.db, cb.wordId) : undefined;
    if (!word) return void (await ctx.answerCallbackQuery({ text: "Этого слова уже нет" }));
    if (word.addedBy !== ctx.user.id) return void (await ctx.answerCallbackQuery({ text: "Отменить может только тот, кто добавил" }));
    await deleteWord(deps.db, word.id);
    await ctx.answerCallbackQuery({ text: "Отменено" });
    await ctx.reply(`↩️ Убрал <b>${esc(word.term)}</b>`, HTML);
  });
}
