import type { Bot } from "grammy";
import type { User } from "../../db/schema";
import {
  createRoom, findRoomByChat, findRoomByInvite, getRoom, isMember, joinRoom, linkGroup, listMembers, listUserRooms,
} from "../../services/rooms";
import { getUser, updateUser } from "../../services/users";
import { decodeCb } from "../callbacks";
import { HTML, inviteLink, type BotContext, type Deps } from "../context";
import { roomKeyboard } from "../keyboards";
import { esc, welcomeText } from "../texts";

async function roomMenu(deps: Deps, user: User) {
  const rooms = await listUserRooms(deps.db, user.id);
  if (rooms.length === 0) {
    return {
      text: "У тебя пока нет комнат. Создай свою или попроси у друга ссылку-приглашение.",
      kb: roomKeyboard([], false),
    };
  }
  const current = rooms.find((r) => r.id === user.currentRoomId) ?? rooms[0];
  const members = await listMembers(deps.db, current.id);
  const text = [
    `🏠 Текущая комната: <b>${esc(current.name)}</b>`,
    `Участники: ${members.map((m) => esc(m.firstName)).join(", ")}`,
    current.telegramChatId != null ? "🔗 Привязана к группе" : "",
  ].filter(Boolean).join("\n");
  return { text, kb: roomKeyboard(rooms.filter((r) => r.id !== current.id), true) };
}

async function createDefaultRoom(ctx: BotContext, deps: Deps, name: string) {
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
    await createDefaultRoom(ctx, deps, ctx.match.trim() || `Комната ${ctx.user.firstName}`);
  });

  bot.callbackQuery(/^rm:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "room") return;
    if (cb.action === "new") return createDefaultRoom(ctx, deps, `Комната ${ctx.user.firstName}`);
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
