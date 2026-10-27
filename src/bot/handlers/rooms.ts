import { currentLang, LANG_CODES, LANGUAGES, langForms, languageOf, type LangCode } from "../../lang";
import { InlineKeyboard, InputFile, type Bot } from "grammy";
import type { Room, User } from "../../db/schema";
import {
  createRoom, deleteRoom, findRoomByChat, roomForLanguage, unlinkGroup, renameRoom, findRoomByInvite, getRoom, isMember, joinAllowed, joinRoom, linkGroup, listMembers, listUserRooms, roomCreationAllowed,
} from "../../services/rooms";
import { getUser, updateUser } from "../../services/users";
import { listRoomWords } from "../../services/words";
import { decodeCb } from "../callbacks";
import { background, HTML, inviteLink, type BotContext, type Deps } from "../context";
import { confirmRoomDeleteKeyboard, groupLinkKeyboard, learnLangKeyboard, roomKeyboard, roomTitle } from "../keyboards";
import { clearPendingInputs } from "../pending";
import { esc, plural, welcomeText } from "../texts";

async function roomMenu(deps: Deps, user: User) {
  const rooms = await listUserRooms(deps.db, user.id);
  if (rooms.length === 0) {
    return {
      text: "У тебя пока нет комнат. Создай свою или попроси у друга ссылку-приглашение.",
      kb: roomKeyboard([]),
    };
  }
  const current = rooms.find((r) => r.id === user.currentRoomId) ?? rooms[0];
  const members = await listMembers(deps.db, current.id);
  // Языки, словаря которых ещё нет (английский личный словарь есть у всех): «🇰🇷 Учить корейский».
  const missing: LangCode[] = [];
  for (const code of LANG_CODES) if (!rooms.some((r) => r.language === code)) missing.push(code);
  if (current.personalOf === user.id) {
    const text = [
      `📒 Сейчас: <b>${esc(roomTitle(current))}</b> — твой личный словарь.`,
      "Учить вместе с друзьями — в общей комнате: создай её (➕) и позови их ссылкой, или вступи по ссылке друга.",
    ].join("\n");
    return { text, kb: roomKeyboard(rooms.filter((r) => r.id !== current.id), current, current.createdBy === user.id, missing) };
  }
  const text = [
    `🏠 Текущая комната: <b>${esc(roomTitle(current))}</b>`,
    `Участники: ${members.map((m) => esc(m.firstName)).join(", ")}`,
    current.telegramChatId != null ? "🔗 Привязана к группе" : "",
  ].filter(Boolean).join("\n");
  return { text, kb: roomKeyboard(rooms.filter((r) => r.id !== current.id), current, current.createdBy === user.id, missing) };
}

const MAX_ROOM_NAME = 64;

async function askRoomName(ctx: BotContext, deps: Deps, renameRoomId?: number): Promise<void> {
  if (!ctx.chat) return;
  clearPendingInputs(deps, ctx.user.id);
  deps.roomNames.ask(ctx.user.id, ctx.chat.id, renameRoomId);
  const question = renameRoomId ? "Как переименовать комнату?" : "Как назвать комнату?";
  await ctx.reply(`${question} Пришли название ответом на это сообщение.`, { reply_markup: { force_reply: true } });
}

async function createNamedRoom(ctx: BotContext, deps: Deps, name: string) {
  // Лимит — до создания: комната сама модель не зовёт, но это запись в `rooms` + `roomMembers`,
  // и «нажал десять раз → десять неотличимых комнат» — именно то, от чего лимит и стоит.
  const gate = await roomCreationAllowed(deps.db, ctx.user.id);
  if (!gate.allowed) return void (await ctx.reply(gate.refusal, HTML));
  // Комната для друзей — на языке, который человек сейчас учит.
  const room = await createRoom(deps.db, { name, createdBy: ctx.user.id, now: deps.now(), language: currentLang().code });
  await ctx.reply(
    `🎉 Комната «${esc(room.name)}» создана и выбрана текущей.\nПришли друзьям ссылку: ${inviteLink(deps.botUsername, room)}`,
    HTML,
  );
}

export function registerRooms(bot: Bot<BotContext>, deps: Deps): void {
  // Видео загружается в Telegram один раз, дальше — по file_id.
  let welcomeVideoId: string | undefined;

  /** 🎬 Минутное видео «как пользоваться» — в личке перед приветствием. Не отправилось — просто без него. */
  async function sendWelcomeVideo(ctx: BotContext): Promise<void> {
    if (!deps.welcomeVideo || ctx.chat?.type !== "private") return;
    try {
      const sent = await ctx.replyWithVideo(welcomeVideoId ?? new InputFile(deps.welcomeVideo), {
        width: 1080,
        height: 1920,
        supports_streaming: true,
        caption: "🎬 Минута о том, как пользоваться ботом",
      });
      welcomeVideoId ??= sent.video?.file_id;
    } catch (err) {
      console.error("Welcome video failed", err);
    }
  }

  bot.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("join_")) {
      const room = await findRoomByInvite(deps.db, payload.slice("join_".length));
      if (!room) return void (await ctx.reply("Ссылка-приглашение недействительна 🤷"));
      // Лимит участий и потолок комнаты — до `joinRoom`: он создаёт карточки на все слова комнаты,
      // и отказ после него оставлял бы человеку чужой словарь, из которого он не просил.
      const gate = await joinAllowed(deps.db, { roomId: room.id, userId: ctx.user.id });
      if (!gate.allowed) return void (await ctx.reply(gate.refusal, HTML));
      const joined = await joinRoom(deps.db, { roomId: room.id, userId: ctx.user.id, now: deps.now(), makeCurrent: true });
      await ctx.reply(
        joined
          ? `🎉 Ты в комнате «${esc(room.name)}»! Все её слова уже ждут тебя в /learn.\nДобавляй свои через /add.`
          : `Ты уже в комнате «${esc(room.name)}», она выбрана текущей.`,
        HTML,
      );
      // Новичок по приглашению тоже не знает, как всё устроено.
      if (joined) background(ctx, () => sendWelcomeVideo(ctx));
      return;
    }
    // Видео грузится несколько секунд — в фоне, а текст после него, чтобы шли по порядку.
    background(ctx, async () => {
      await sendWelcomeVideo(ctx);
      // Под приветствием — что учим: английский или корейский.
      await ctx.reply(welcomeText(), ctx.chat.type === "private" ? { ...HTML, reply_markup: learnLangKeyboard() } : HTML);
    });
  });

  // /lang — какой язык учим: переключает в комнату выбранного языка.
  bot.command("lang", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Язык переключается в личке: https://t.me/${deps.botUsername}. Язык группы — её комната: /link`));
    const current = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    const lang = languageOf(current?.language);
    const where = current ? ` — «${esc(roomTitle(current))}»` : "";
    await ctx.reply(`Сейчас учишь: ${lang.flag} ${lang.name}${where}.\nНа какой язык переключиться?`, { ...HTML, reply_markup: learnLangKeyboard(lang.code) });
  });

  // 🇰🇷 Учить корейский (и обратно): /start, /room, /lang — в комнату выбранного языка.
  bot.callbackQuery(/^ll:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "learnLang" || ctx.chat?.type !== "private") return;
    const lang = LANGUAGES[cb.lang];
    const forms = langForms(lang);
    const current = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (current?.language === cb.lang) {
      return void (await ctx.reply(`${lang.flag} Ты и так учишь ${lang.name} — сейчас в «${esc(roomTitle(current))}». Пришли слово, и начнём 🙂`, HTML));
    }
    // Туда, где человек был последним на этом языке; первый раз — заводим личный словарь.
    const { room, created } = await roomForLanguage(deps.db, ctx.user, cb.lang, deps.now());
    await updateUser(deps.db, ctx.user.id, { currentRoomId: room.id });
    if (!created) {
      return void (await ctx.reply(`${lang.flag} Учим ${lang.name} — комната «${esc(roomTitle(room))}». Обратно — /lang`, HTML));
    }
    await ctx.reply(
      [
        `${lang.flag} Учим ${lang.name}! Текущая комната — «${esc(roomTitle(room))}», твой личный словарь.`,
        "",
        `Пришли слово ${forms.adv} или по-русски — подберу перевод, транскрипцию, пример и озвучку. Потом повторяй в /learn или /app.`,
        "Вернуться к другому языку — /lang.",
      ].join("\n"),
      HTML,
    );
  });

  bot.command("help", (ctx) => ctx.reply(welcomeText(), HTML));

  bot.command("room", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply("Управлять комнатами можно в личке со мной"));
    const { text, kb } = await roomMenu(deps, ctx.user);
    await ctx.reply(text, { ...HTML, reply_markup: kb });
  });

  bot.command("newroom", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply("Создать комнату можно в личке со мной"));
    const name = ctx.match.trim();
    if (!name) return askRoomName(ctx, deps);
    await createNamedRoom(ctx, deps, name.slice(0, MAX_ROOM_NAME));
  });

  bot.callbackQuery(/^rm:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "room") return;
    if (cb.action === "new") return askRoomName(ctx, deps);
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) return void (await ctx.reply("Сначала создай комнату: /newroom"));
    // В личный словарь не зовут: туда идут и слова из наборов — друзей бы ими засыпало.
    if (room.personalOf != null) return askRoomName(ctx, deps);
    await ctx.reply(`Ссылка-приглашение в «${esc(room.name)}»:\n${inviteLink(deps.botUsername, room)}`, HTML);
  });

  bot.callbackQuery(/^rs:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "roomsw" || !(await isMember(deps.db, cb.roomId, ctx.user.id))) {
      return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
    }
    const user = await updateUser(deps.db, ctx.user.id, { currentRoomId: cb.roomId });
    await ctx.answerCallbackQuery({ text: "Комната переключена" });
    const { text, kb } = await roomMenu(deps, user);
    await ctx.editMessageText(text, { ...HTML, reply_markup: kb });
  });

  // Ответ с названием новой комнаты. Регистрируется раньше общего обработчика текста (иначе стал бы /add).
  bot.on("message:text", async (ctx, next) => {
    const pending =
      ctx.message.text.startsWith("/") || ctx.chat.type !== "private" ? undefined : deps.roomNames.take(ctx.user.id, ctx.chat.id);
    if (!pending) return next();
    const name = ctx.message.text.trim().slice(0, MAX_ROOM_NAME);
    if (pending.renameRoomId === undefined) return createNamedRoom(ctx, deps, name);
    const room = await getRoom(deps.db, pending.renameRoomId);
    if (!room || room.createdBy !== ctx.user.id) return void (await ctx.reply("Переименовать комнату может только её создатель"));
    await renameRoom(deps.db, room.id, name);
    await ctx.reply(`✏️ Комната «${esc(room.name)}» теперь называется «${esc(name)}»`, HTML);
  });

  bot.callbackQuery(/^rn:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const room = cb?.k === "roomRename" ? await getRoom(deps.db, cb.roomId) : undefined;
    if (!room || room.createdBy !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Переименовать комнату может только её создатель" }));
    }
    await ctx.answerCallbackQuery();
    await askRoomName(ctx, deps, room.id);
  });

  bot.callbackQuery(/^rx:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const room = cb?.k === "roomDel" ? await getRoom(deps.db, cb.roomId) : undefined;
    if (!room || room.createdBy !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Удалить комнату может только её создатель" }));
    }
    await ctx.answerCallbackQuery();
    const [members, roomWords] = await Promise.all([listMembers(deps.db, room.id), listRoomWords(deps.db, room.id)]);
    await ctx.reply(
      `Удалить комнату «${esc(room.name)}» для всех? Пропадут ${roomWords.length} ${plural(roomWords.length, "слово", "слова", "слов")} и прогресс ${members.length} ${plural(members.length, "участника", "участников", "участников")}. Это не отменить.`,
      { ...HTML, reply_markup: confirmRoomDeleteKeyboard(room.id) },
    );
  });

  bot.callbackQuery(/^rxo:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const room = cb?.k === "roomDelOk" ? await getRoom(deps.db, cb.roomId) : undefined;
    if (!room || room.createdBy !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Удалить комнату может только её создатель" }));
    }
    await deleteRoom(deps.db, room.id);
    await ctx.answerCallbackQuery({ text: "Удалено" });
    await ctx.editMessageText(`🗑 Комната «${esc(room.name)}» удалена. Твои комнаты — /room`, HTML);
  });

  bot.command("link", async (ctx) => {
    if (ctx.chat.type === "private") {
      return void (await ctx.reply("Отправь /link в группе — покажу, к какой комнате она привязана, и можно будет сменить"));
    }
    const { text, kb } = await groupLinkMenu(ctx);
    await ctx.reply(text, { ...HTML, ...(kb ? { reply_markup: kb } : {}) });
  });

  /** Привязать группу к комнате: своей общей (gl:) или новой на выбранном языке (gn:). */
  bot.callbackQuery(/^g[ln]:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const chat = ctx.chat;
    if (!chat || chat.type === "private" || (cb?.k !== "groupLink" && cb?.k !== "groupNew")) return void (await ctx.answerCallbackQuery());
    const linked = await findRoomByChat(deps.db, chat.id);
    if (!(await canRelink(ctx, linked))) {
      return void (await ctx.answerCallbackQuery({ text: "Сменить комнату группы может админ группы или создатель комнаты", show_alert: true }));
    }
    let room: Room | undefined;
    if (cb.k === "groupLink") {
      const target = await getRoom(deps.db, cb.roomId);
      if (!target || target.personalOf != null || !(await isMember(deps.db, target.id, ctx.user.id))) {
        return void (await ctx.answerCallbackQuery({ text: "Ты не в этой комнате" }));
      }
      if (target.telegramChatId != null && target.telegramChatId !== chat.id) {
        return void (await ctx.answerCallbackQuery({ text: "Эта комната уже привязана к другой группе" }));
      }
      await unlinkGroup(deps.db, chat.id);
      await linkGroup(deps.db, target.id, chat.id);
      room = target;
    } else {
      // Новая комната из группы — тоже комната: тот же лимит, что у «Комната для друзей».
      const gate = await roomCreationAllowed(deps.db, ctx.user.id);
      if (!gate.allowed) {
        return void (await ctx.answerCallbackQuery({ text: gate.refusal, show_alert: true }));
      }
      await unlinkGroup(deps.db, chat.id);
      room = await createRoom(deps.db, {
        name: "title" in chat ? chat.title : "Группа",
        createdBy: ctx.user.id,
        now: deps.now(),
        telegramChatId: chat.id,
        language: cb.lang,
      });
    }
    await ctx.answerCallbackQuery({ text: "Готово" });
    const lang = languageOf(room.language);
    await ctx.editMessageText(
      `🔗 Группа теперь учит ${lang.flag} ${lang.name} — комната «${esc(roomTitle(room))}». Добавляйте слова через /add`,
      HTML,
    );
  });

  /** Текст и кнопки /link в группе: к чему привязана и на что сменить. Без прав на смену — без кнопок. */
  async function groupLinkMenu(ctx: BotContext): Promise<{ text: string; kb?: InlineKeyboard }> {
    const linked = await findRoomByChat(deps.db, ctx.chat!.id);
    const options = (await listUserRooms(deps.db, ctx.user.id)).filter((r) => r.personalOf == null && r.telegramChatId == null);
    if (!linked) return { text: "К какой комнате привязать группу? Новые слова и «знаешь?» пойдут в неё.", kb: groupLinkKeyboard(options) };
    const lang = languageOf(linked.language);
    const now = `🔗 Группа привязана к «${esc(roomTitle(linked))}» — учит ${lang.flag} ${lang.name}.`;
    if (!(await canRelink(ctx, linked))) return { text: `${now}\nСменить комнату может админ группы или создатель комнаты.` };
    return { text: `${now}\nСменить комнату группы — на свою общую или новую:`, kb: groupLinkKeyboard(options) };
  }

  /** Перепривязать группу может её админ или создатель привязанной комнаты; непривязанную — любой. */
  async function canRelink(ctx: BotContext, linked: Room | undefined): Promise<boolean> {
    if (!linked || linked.createdBy === ctx.user.id) return true;
    try {
      const member = await ctx.getChatMember(ctx.from!.id);
      return member.status === "creator" || member.status === "administrator";
    } catch {
      return false;
    }
  }
}
