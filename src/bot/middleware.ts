import type { MiddlewareFn } from "grammy";
import { findRoomByChat, joinRoom } from "../services/rooms";
import { updateUser, upsertUser } from "../services/users";
import type { BotContext, Deps } from "./context";
import { esc } from "./texts";

/** Регистрирует пользователя, отмечает возможность писать в личку и добавляет в комнату привязанной группы. */
export function userMiddleware(deps: Deps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    let user = await upsertUser(deps.db, ctx.from, deps.now());
    if (ctx.chat?.type === "private" && !user.canDm) user = await updateUser(deps.db, user.id, { canDm: true });
    ctx.user = user;

    if (ctx.chat && ctx.chat.type !== "private") {
      const room = await findRoomByChat(deps.db, ctx.chat.id);
      if (room) {
        await joinRoom(deps.db, { roomId: room.id, userId: user.id, now: deps.now(), makeCurrent: false });
        if (!user.canDm && !user.groupHintSent) {
          await ctx.reply(
            `${esc(user.firstName)}, чтобы получать новые слова и напоминания, открой https://t.me/${deps.botUsername} и нажми Start`,
          );
          ctx.user = await updateUser(deps.db, user.id, { groupHintSent: true });
        }
      }
    }
    await next();
  };
}
