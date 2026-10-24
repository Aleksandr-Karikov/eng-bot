import type { Bot, InputFile } from "grammy";
import type { Message } from "grammy/types";
import type { User } from "../../db/schema";
import type { DrillQuestion } from "../../llm/tutor";
import type { DrillState } from "../drills";
import { clearMistakes, mistakeProfile, recentMistakes, resolvedTopics } from "../../services/mistakes";
import { HTML, type BotContext, type Deps } from "../context";
import { drillKeyboard, mistakesKeyboard } from "../keyboards";
import { drillQuestionText, mistakesText } from "../texts";

/** Вопросы готовятся, как только есть хотя бы одна ошибка. */
export const MIN_MISTAKES = 1;
const QUESTIONS_PER_BATCH = 3;

/** Сколько последних заданных вопросов помнить, чтобы Claude не повторял их. */
const ASKED_MEMORY = 30;
const askedByUser = new Map<number, string[]>();

export function rememberAsked(userId: number, question: string): void {
  askedByUser.set(userId, [...(askedByUser.get(userId) ?? []), question].slice(-ASKED_MEMORY));
}

export async function prepareDrill(deps: Deps, user: User): Promise<DrillQuestion[]> {
  const profile = mistakeProfile(await recentMistakes(deps.db, user.id, deps.now()));
  if (profile.total < MIN_MISTAKES) return [];
  return deps.tutor.drill(profile.text, QUESTIONS_PER_BATCH, askedByUser.get(user.id) ?? []);
}

const RETRY_AFTER_MS = 10 * 60_000;

/**
 * Готовит вопросы в фоне, если их нет и режим включён. Вызывается и в начале /learn, и на каждом ответе —
 * чтобы сессия, продолженная без /learn (например после перезапуска бота), тоже получила вопросы.
 */
export function ensureDrill(ctx: BotContext, deps: Deps): void {
  ensureDrillFor(deps, ctx.user);
}

/** То же для приложения: там нет контекста Telegram, только пользователь. */
export function ensureDrillFor(deps: Deps, user: User): void {
  if (!user.modeDrill) return;
  let state = deps.drills.get(user.id);
  if (!state || state.standalone) {
    state = { questions: state?.questions ?? [], standalone: false, lastAtCount: 0 };
    deps.drills.set(user.id, state);
  }
  if (state.questions.length || state.loading || (state.retryAfter ?? 0) > Date.now()) return;
  const target = state;
  target.loading = prepareDrill(deps, user)
    .then((qs) => {
      target.questions.push(...qs);
      target.retryAfter = qs.length ? undefined : Date.now() + RETRY_AFTER_MS;
    })
    .catch((err) => {
      target.retryAfter = Date.now() + RETRY_AFTER_MS;
      console.error("Drill generation failed", err);
    })
    .finally(() => (target.loading = undefined));
}

/** Начало сессии /learn: счёт подмешивания с нуля, вопросы — в фоне. */
export function prefetchDrill(ctx: BotContext, deps: Deps): void {
  ensureDrill(ctx, deps);
  const state = deps.drills.get(ctx.user.id);
  if (!state) return;
  state.lastAtCount = 0;
  // Неотвеченный вопрос прошлой сессии больше не актуален.
  state.current = undefined;
  state.currentId = undefined;
}

/**
 * reply — новым сообщением; replace — новым сообщением, а прежнее (с кнопкой, на которую нажали) удалить.
 * Редактировать на месте нельзя: мобильный Telegram оставляет спойлер раскрытым после редактирования.
 */
export type PresentMode = "reply" | "replace";

/** photo — file_id или файл картинки: тогда сообщение — фото, а text идёт подписью. Возвращает отправленное. */
export async function present(
  ctx: BotContext,
  text: string,
  options: object,
  mode: PresentMode,
  photo?: string | InputFile,
): Promise<Message> {
  // Итог прошлого ответа — в начале этого же сообщения: следующее задание его не вытесняет наверх.
  const lead = ctx.lead;
  ctx.lead = undefined;
  if (lead && photo && lead.length + text.length + 2 > CAPTION_LIMIT) await ctx.reply(lead, { parse_mode: "HTML" });
  else if (lead) text = `${lead}\n\n${text}`;
  const sent = photo ? await ctx.replyWithPhoto(photo, { ...options, caption: text }) : await ctx.reply(text, options);
  if (mode === "replace") await ctx.deleteMessage().catch(() => {});
  return sent;
}

/** Лимит подписи к фото в Telegram. */
const CAPTION_LIMIT = 1024;

let questionSeq = 0;

/** Делает вопрос текущим (с новым номером показа) и отправляет его. */
export async function sendDrillQuestion(ctx: BotContext, state: DrillState, q: DrillQuestion, mode: PresentMode): Promise<void> {
  state.current = q;
  state.currentId = ++questionSeq;
  rememberAsked(ctx.user.id, q.question);
  await present(ctx, drillQuestionText(q), { ...HTML, reply_markup: drillKeyboard(q, state.currentId) }, mode);
}

export function registerMistakes(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("mistakes", async (ctx) => {
    const profile = mistakeProfile(await recentMistakes(deps.db, ctx.user.id, deps.now()));
    const resolved = await resolvedTopics(deps.db, ctx.user.id, deps.now());
    await ctx.reply(mistakesText(profile, resolved), { ...HTML, reply_markup: profile.total ? mistakesKeyboard() : undefined });
  });

  bot.callbackQuery(/^mz$/, async (ctx) => {
    await clearMistakes(deps.db, ctx.user.id);
    deps.drills.delete(ctx.user.id);
    await ctx.answerCallbackQuery({ text: "Сброшено" });
    await ctx.editMessageText("🧠 Список ошибок очищен — начнём заново.");
  });
}
