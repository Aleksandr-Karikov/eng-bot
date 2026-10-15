import type { Bot } from "grammy";
import type { Room, User, Word } from "../../db/schema";
import type { Enrichment } from "../../llm/enricher";
import { findRoomByChat, getRoom } from "../../services/rooms";
import { findWord, parseAddInput, saveWord } from "../../services/words";
import { decodeCb } from "../callbacks";
import { HTML, type BotContext, type Deps } from "../context";
import type { Draft } from "../drafts";
import { draftKeyboard, knowKeyboard } from "../keyboards";
import { announceText, draftText, esc, knowPrompt } from "../texts";

const USAGE = "Напиши слово после команды: /add serendipity\nМожно сразу с переводом: /add bank — берег";

async function resolveRoom(ctx: BotContext, deps: Deps): Promise<Room | undefined> {
  if (ctx.chat?.type === "private") {
    const room = ctx.user.currentRoomId != null ? await getRoom(deps.db, ctx.user.currentRoomId) : undefined;
    if (!room) await ctx.reply("Сначала создай комнату (/newroom) или вступи по ссылке друга");
    return room;
  }
  const room = ctx.chat ? await findRoomByChat(deps.db, ctx.chat.id) : undefined;
  if (!room) await ctx.reply("Эта группа ещё не привязана к комнате — отправь /link");
  return room;
}

async function askForTranslation(ctx: BotContext, draft: Draft, reason: string): Promise<void> {
  draft.awaitingEdit = true;
  await ctx.reply(`${reason} <b>${esc(draft.term)}</b> — пришли перевод ответом на это сообщение.`, {
    ...HTML,
    reply_markup: { force_reply: true },
  });
}

async function sendPreview(ctx: BotContext, draft: Draft): Promise<void> {
  await ctx.reply(draftText(draft), { ...HTML, reply_markup: draftKeyboard(draft.id) });
}

async function startAdd(ctx: BotContext, deps: Deps, input: string): Promise<void> {
  const parsed = parseAddInput(input);
  if (!parsed) return void (await ctx.reply(USAGE));
  const room = await resolveRoom(ctx, deps);
  if (!room || !ctx.chat) return;
  if (await findWord(deps.db, room.id, parsed.term)) {
    return void (await ctx.reply(`«${esc(parsed.term)}» уже есть в комнате`, HTML));
  }

  await ctx.replyWithChatAction("typing");
  let enrichment: Enrichment | undefined;
  try {
    enrichment = await deps.enricher.enrich(parsed.term, parsed.translation);
  } catch (err) {
    console.error("Enrichment failed", parsed.term, err);
  }

  const draft = deps.drafts.create({
    userId: ctx.user.id,
    chatId: ctx.chat.id,
    roomId: room.id,
    term: parsed.term,
    translation: parsed.translation ?? enrichment?.translation ?? "",
    explanation: enrichment?.explanation ?? "",
    example: enrichment?.example ?? "",
  });
  if (!draft.translation) return askForTranslation(ctx, draft, "Не получилось подобрать перевод для");
  await sendPreview(ctx, draft);
}

async function broadcastWord(deps: Deps, word: Word, members: User[], adder: User, currentChatId?: number) {
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

export function registerAdd(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("add", (ctx) => startAdd(ctx, deps, ctx.match));

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return next();
    const awaiting = deps.drafts.findAwaiting(ctx.user.id, ctx.chat.id);
    if (awaiting) {
      awaiting.translation = text.trim();
      awaiting.awaitingEdit = false;
      return sendPreview(ctx, awaiting);
    }
    if (ctx.chat.type === "private") return startAdd(ctx, deps, text);
    return next();
  });

  bot.callbackQuery(/^d:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const draft = cb?.k === "draft" ? deps.drafts.get(cb.id) : undefined;
    if (cb?.k !== "draft" || !draft || draft.userId !== ctx.user.id) {
      return void (await ctx.answerCallbackQuery({ text: "Этот черновик уже неактуален" }));
    }
    if (cb.action === "cancel") {
      deps.drafts.delete(draft.id);
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText("❌ Отменено"));
    }
    if (cb.action === "edit") {
      await ctx.answerCallbackQuery();
      return askForTranslation(ctx, draft, "Исправляем перевод для");
    }

    deps.drafts.delete(draft.id);
    const result = await saveWord(deps.db, {
      roomId: draft.roomId,
      addedBy: ctx.user.id,
      draft: { term: draft.term, translation: draft.translation, explanation: draft.explanation, example: draft.example },
      now: deps.now(),
    });
    if (result.status === "duplicate") {
      await ctx.answerCallbackQuery();
      return void (await ctx.editMessageText(`«${esc(draft.term)}» уже есть в комнате`, HTML));
    }
    await ctx.answerCallbackQuery({ text: "Добавлено!" });
    await ctx.editMessageText(`✅ Добавлено\n\n${draftText(result.word)}`, HTML);
    await broadcastWord(deps, result.word, result.members, ctx.user, ctx.chat?.id);
  });
}
