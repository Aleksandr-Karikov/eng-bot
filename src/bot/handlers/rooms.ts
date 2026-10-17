import type { Bot } from "grammy";
import type { User } from "../../db/schema";
import {
  createRoom, deleteRoom, findRoomByChat, renameRoom, findRoomByInvite, getRoom, isMember, joinRoom, linkGroup, listMembers, listUserRooms,
} from "../../services/rooms";
import { getUser, updateUser } from "../../services/users";
import { listRoomWords } from "../../services/words";
import { decodeCb } from "../callbacks";
import { HTML, inviteLink, type BotContext, type Deps } from "../context";
import { confirmRoomDeleteKeyboard, roomKeyboard } from "../keyboards";
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
  const text = [
    `🏠 Текущая комната: <b>${esc(current.name)}</b>`,
    `Участники: ${members.map((m) => esc(m.firstName)).join(", ")}`,
    current.telegramChatId != null ? "🔗 Привязана к группе" : "",
  ].filter(Boolean).join("\n");
  return { text, kb: roomKeyboard(rooms.filter((r) => r.id !== current.id), current, current.createdBy === user.id) };
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
  const room = await createRoom(deps.db, { name, createdBy: ctx.user.id, now: deps.now() });
  await ctx.reply(
    `🎉 Комната «${esc(room.name)}» создана и выбрана текущей.\nПришли друзьям ссылку: ${inviteLink(deps.botUsername, room)}`,
    HTML,
  );
}

export function registerRooms(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("start", async (ctx) => {
    const payload = ctx.match.trim();
    if (payload.startsWith("join_")) {
      const room = await findRoomByInvite(deps.db, payload.slice("join_".length));
      if (!room) return void (await ctx.reply("Ссылка-приглашение недействительна 🤷"));
      const joined = await joinRoom(deps.db, { roomId: room.id, userId: ctx.user.id, now: deps.now(), makeCurrent: true });
      await ctx.reply(
        joined
          ? `🎉 Ты в комнате «${esc(room.name)}»! Все её слова уже ждут тебя в /learn.\nДобавляй свои через /add.`
          : `Ты уже в комнате «${esc(room.name)}», она выбрана текущей.`,
        HTML,
      );
      return;
    }
    await ctx.reply(welcomeText(), HTML);
  });

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
      return void (await ctx.reply("Отправь /link в группе, которую хочешь привязать к своей текущей комнате"));
    }
    const existing = await findRoomByChat(deps.db, ctx.chat.id);
    if (existing) return void (await ctx.reply(`Группа уже привязана к «${esc(existing.name)}»`, HTML));

    const user = await getUser(deps.db, ctx.user.id);
    if (user?.currentRoomId == null) {
      const room = await createRoom(deps.db, {
        name: "title" in ctx.chat ? ctx.chat.title : "Группа",
        createdBy: ctx.user.id,
        now: deps.now(),
        telegramChatId: ctx.chat.id,
      });
      return void (await ctx.reply(`🔗 Создал комнату «${esc(room.name)}» для этой группы. Добавляйте слова через /add`, HTML));
    }
    const result = await linkGroup(deps.db, user.currentRoomId, ctx.chat.id);
    const room = await getRoom(deps.db, user.currentRoomId);
    if (result === "room_has_group") {
      await ctx.reply("Твоя текущая комната уже привязана к другой группе. Создай новую (/newroom) или переключись в /room — в личке.");
      return;
    }
    await ctx.reply(`🔗 Группа привязана к «${esc(room?.name ?? "")}». Добавляйте слова через /add`, HTML);
  });
}
