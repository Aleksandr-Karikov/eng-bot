import type { Bot } from "grammy";
import type { User } from "../../db/schema";
import type { DrillQuestion } from "../../llm/tutor";
import { clearMistakes, mistakeProfile, recentMistakes } from "../../services/mistakes";
import { HTML, type BotContext, type Deps } from "../context";
import { drillKeyboard, mistakesKeyboard } from "../keyboards";
import { drillQuestionText, mistakesText } from "../texts";

/** Вопросы готовятся, как только есть хотя бы одна ошибка. */
export const MIN_MISTAKES = 1;
const QUESTIONS_PER_BATCH = 3;

export async function prepareDrill(deps: Deps, user: User): Promise<DrillQuestion[]> {
  const profile = mistakeProfile(await recentMistakes(deps.db, user.id, deps.now()));
  if (profile.total < MIN_MISTAKES) return [];
  return deps.tutor.drill(profile.text, QUESTIONS_PER_BATCH);
}

/** В начале /learn готовит вопросы в фоне, если их нет и режим включён. */
export function prefetchDrill(ctx: BotContext, deps: Deps): void {
  if (!ctx.user.modeDrill) return;
  let state = deps.drills.get(ctx.user.id);
  if (!state || state.standalone) {
    state = { questions: state?.questions ?? [], standalone: false, lastAtCount: 0 };
    deps.drills.set(ctx.user.id, state);
  }
  state.lastAtCount = 0;
  if (state.questions.length || state.loading) return;
  const target = state;
  target.loading = prepareDrill(deps, ctx.user)
    .then((qs) => void target.questions.push(...qs))
    .catch((err) => console.error("Drill generation failed", err))
    .finally(() => (target.loading = undefined));
}

export async function sendDrillQuestion(ctx: BotContext, q: DrillQuestion, mode: "reply" | "edit"): Promise<void> {
  const options = { ...HTML, reply_markup: drillKeyboard(q) };
  if (mode === "edit") await ctx.editMessageText(drillQuestionText(q), options);
  else await ctx.reply(drillQuestionText(q), options);
}

export function registerMistakes(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("mistakes", async (ctx) => {
    const profile = mistakeProfile(await recentMistakes(deps.db, ctx.user.id, deps.now()));
    await ctx.reply(mistakesText(profile), { ...HTML, reply_markup: profile.total ? mistakesKeyboard() : undefined });
  });

  bot.callbackQuery(/^mz$/, async (ctx) => {
    await clearMistakes(deps.db, ctx.user.id);
    deps.drills.delete(ctx.user.id);
    await ctx.answerCallbackQuery({ text: "Сброшено" });
    await ctx.editMessageText("🧠 Список ошибок очищен — начнём заново.");
  });
}
