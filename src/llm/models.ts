import type { Provider } from "./provider";

/**
 * Алиасы Claude Code (`haiku`, `sonnet`) и имена моделей OpenRouter (`anthropic/claude-haiku-5.5`) —
 * разные пространства имён: одно имя на оба провайдера не подставить. Поэтому у каждого провайдера
 * свои переменные, а здесь решается, какое имя уйдёт в запрос.
 *
 * Имя по умолчанию у OpenRouter намеренно пустое: `anthropic/claude-3.5-haiku` уже снят с обслуживания
 * (проверено на живом API 2026-10-27), и зашитое имя однажды молча сломает все запросы. Пустое честнее —
 * оно говорит «задай в .env», а не «модель не найдена» из глубины OpenRouter.
 */
export interface ModelSets {
  /** Английские алиасы Claude Code: haiku / sonnet. */
  claudeCode: { main: string; mnemonic: string; check: string };
  /** Полные имена OpenRouter; main может быть пустым — значит, не настроено. */
  openrouter: { main: string; mnemonic: string; check: string };
}

export const OPENROUTER_MODEL_HINT = "OPENROUTER_MODEL в .env (список: https://openrouter.ai/models)";

/** Набор моделей провайдера; у OpenRouter пустые места занимает main, чтобы не требовать три переменные. */
export function modelsFor(provider: Provider, sets: ModelSets): { main: string; mnemonic: string; check: string } {
  if (provider === "claude-code") return sets.claudeCode;
  const { main, mnemonic, check } = sets.openrouter;
  return { main, mnemonic: mnemonic || main, check: check || main };
}
