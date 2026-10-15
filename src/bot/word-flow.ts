import type { Room, User, Word } from "../db/schema";
import { findRoomByChat, getRoom, listMembers } from "../services/rooms";
import { HTML, type BotContext, type Deps } from "./context";
import type { Draft } from "./drafts";
import { draftKeyboard, knowKeyboard } from "./keyboards";
import { announceText, batchSummaryText, draftText, esc, knowPrompt } from "./texts";

/** Комната для добавления: текущая — в личке, привязанная — в группе. Сам объясняет пользователю, если её нет. */
export async function resolveRoom(ctx: BotContext, deps: Deps): Promise<Room | undefined> {
  if (ctx.chat?.type === "private") {
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) await ctx.reply("Сначала создай комнату (/newroom) или вступи по ссылке друга");
    return room;
  }
  const room = ctx.chat ? await findRoomByChat(deps.db, ctx.chat.id) : undefined;
  if (!room) await ctx.reply("Эта группа ещё не привязана к комнате — отправь /link");
  return room;
}

export async function askForTranslation(ctx: BotContext, draft: Draft, reason: string): Promise<void> {
  draft.awaitingEdit = true;
  await ctx.reply(`${reason} <b>${esc(draft.term)}</b> — пришли перевод ответом на это сообщение.`, {
    ...HTML,
    reply_markup: { force_reply: true },
  });
}

export async function sendPreview(ctx: BotContext, draft: Draft): Promise<void> {
  const text = draft.progress ? `<b>${draft.progress}</b>\n\n${draftText(draft)}` : draftText(draft);
  await ctx.reply(text, { ...HTML, reply_markup: draftKeyboard(draft.id, draft.batchId !== undefined) });
}

/** Одно слово: объявление в группу и «знаешь?» каждому участнику, кроме автора. */
export async function broadcastWord(deps: Deps, word: Word, members: User[], adder: User, currentChatId?: number) {
  const room = await getRoom(deps.db, word.roomId);
  if (!room) return;
  if (room.telegramChatId != null && room.telegramChatId !== currentChatId) {
    await deps.notifier.group(room.telegramChatId, announceText(adder.firstName, word), HTML);
  }
  for (const member of members) {
    if (member.id === adder.id) continue;
    await deps.notifier.dm(member, knowPrompt(adder.firstName, word, room.name), {
      ...HTML,
      reply_markup: knowKeyboard(word.id),
    });
  }
}

/** Пачка слов: одно сводное сообщение вместо «знаешь?» на каждое слово. */
export async function broadcastBatch(deps: Deps, roomId: number, words: Word[], adder: User, currentChatId?: number) {
  if (words.length === 0) return;
  const room = await getRoom(deps.db, roomId);
  if (!room) return;
  const text = batchSummaryText(adder.firstName, words, room.name);
  if (room.telegramChatId != null && room.telegramChatId !== currentChatId) {
    await deps.notifier.group(room.telegramChatId, text, HTML);
  }
  for (const member of await listMembers(deps.db, roomId)) {
    if (member.id !== adder.id) await deps.notifier.dm(member, text, HTML);
  }
}
