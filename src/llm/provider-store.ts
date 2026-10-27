import { readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isProvider, type Provider } from "./provider";

/**
 * Где помнить выбранного провайдера между перезапусками.
 *
 * `scripts/llm.ts` правит `.env`, но бот этого делать не должен: `.env` — файл человека, и переписывать
 * его из работающего процесса (да ещё и с ключами) опаснее, чем завести отдельный маленький файл.
 * Поэтому источник истины при старте такой: файл → переменная LLM_PROVIDER в .env → Claude Code.
 *
 * Файл маленький и в `data/`, то есть не в git и попадает в бэкапы вместе с базой.
 */
export function readProvider(path: string): Provider | undefined {
  try {
    const value = readFileSync(path, "utf8").trim();
    return isProvider(value) ? value : undefined;
  } catch {
    // Файла нет — это норма: ещё ни разу не переключали.
    return undefined;
  }
}

/** Best-effort: не сумели записать — не повод падать, выбор всё равно уже применён в памяти. */
export function writeProvider(path: string, provider: Provider): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${provider}\n`, "utf8");
    return true;
  } catch (err) {
    console.error(`Не удалось сохранить провайдера в ${path}:`, err);
    return false;
  }
}

/** Кого выбрать при старте: сохранённый выбор важнее переменной в .env, иначе — значение по умолчанию. */
export function initialProvider(path: string, fromEnv: Provider): Provider {
  return readProvider(path) ?? fromEnv;
}
