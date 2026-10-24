import type { MiddlewareFn } from "grammy";
import { ensurePersonalRoom, findRoomByChat, isMember, joinRoom } from "../services/rooms";
import { getUser, updateUser, upsertUser } from "../services/users";
import { HTML, type BotContext, type Deps } from "./context";
import { esc } from "./texts";

/** Регистрирует пользователя, отмечает возможность писать в личку и добавляет в комнату привязанной группы. */
export function userMiddleware(deps: Deps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    let user = await upsertUser(deps.db, ctx.from, deps.now());
    if (ctx.chat?.type === "private" && !user.canDm) user = await updateUser(deps.db, user.id, { canDm: true });
    // Пришёл в личку без комнаты — сразу личный словарь: со словами можно работать без «создай комнату».
    if (ctx.chat?.type === "private" && user.currentRoomId == null) {
      await ensurePersonalRoom(deps.db, user.id, deps.now());
      user = (await getUser(deps.db, user.id)) ?? user;
    }
    ctx.user = user;

    if (ctx.chat && ctx.chat.type !== "private") {
      const room = await findRoomByChat(deps.db, ctx.chat.id);
      // Комната группы — один запрос на апдейт, дальше обработчики берут её из ctx.
      ctx.groupRoom = room ?? null;
      if (room && !(await isMember(deps.db, room.id, user.id))) {
        await joinRoom(deps.db, { roomId: room.id, userId: user.id, now: deps.now(), makeCurrent: false });
      }
      if (room && !user.canDm && !user.groupHintSent) {
        await ctx.reply(
          `${esc(user.firstName)}, чтобы получать новые слова и напоминания, открой https://t.me/${deps.botUsername} и нажми Start`,
          HTML,
        );
        ctx.user = await updateUser(deps.db, user.id, { groupHintSent: true });
      }
    }
    await next();
  };
}
