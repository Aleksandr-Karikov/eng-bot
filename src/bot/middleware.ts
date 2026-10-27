import type { MiddlewareFn } from "grammy";
import { isLangCode, withLang, type LangCode } from "../lang";
import { ensurePersonalRoom, findRoomByChat, getRoom, isMember, joinRoom } from "../services/rooms";
import { getUser, updateUser, upsertUser } from "../services/users";
import { HTML, type BotContext, type Deps } from "./context";
import { esc } from "./texts";

/** Регистрирует пользователя, отмечает возможность писать в личку и добавляет в комнату привязанной группы. */
export function userMiddleware(deps: Deps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    // Инлайн-запрос приходит без чата (`chosen_inline_result` — тоже, а у нажатия кнопки под инлайн-карточкой
    // чата нет вовсе). Комнаты, личного словаря и языка тут взять неоткуда: язык оставляем английским по
    // умолчанию, а слова ищем по всем комнатам человека (см. src/services/inline.ts).
    if (!ctx.chat) {
      ctx.user = await upsertUser(deps.db, ctx.from, deps.now());
      return await withLang("en", () => next());
    }
    let user = await upsertUser(deps.db, ctx.from, deps.now());
    if (ctx.chat?.type === "private" && !user.canDm) user = await updateUser(deps.db, user.id, { canDm: true });
    // Личный словарь «Мои слова» — у каждого, кто пишет в личку: на него можно переключиться в любой момент,
    // а без комнаты он сразу становится текущим — со словами можно работать без «создай комнату».
    if (ctx.chat?.type === "private") {
      const hadRoom = user.currentRoomId != null;
      await ensurePersonalRoom(deps.db, user.id, deps.now());
      if (!hadRoom) user = (await getUser(deps.db, user.id)) ?? user;
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
    // Язык апдейта — язык комнаты, о которой речь: в группе — её комнаты, в личке — текущей. Дальше его видят
    // промпты, озвучка и распознавание (lang.ts), не протаскивая через каждый обработчик.
    const room = ctx.chat?.type === "private" ? (user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined) : ctx.groupRoom;
    const lang: LangCode = isLangCode(room?.language) ? room.language : "en";
    await withLang(lang, () => next());
  };
}
