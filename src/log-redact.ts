import { inspect } from "node:util";

/**
 * Убирает секрет из всего, что пишется в лог. Ошибки сети grammY содержат адрес запроса,
 * а в нём — токен бота (api.telegram.org/bot<токен>/sendMessage). Вызывается и для ключа OpenRouter:
 * тела ошибок от провайдера попадают в лог как есть, а ключ уходит в заголовке запроса.
 *
 * label нужен, когда секретов больше одного: по подписи в логе видно, что именно вырезано.
 */
export function redactLogs(secret: string, label = "<BOT_TOKEN>", target: Pick<Console, "log" | "warn" | "error"> = console): void {
  if (!secret) return;
  const redact = (arg: unknown) => {
    const text = typeof arg === "string" ? arg : inspect(arg, { depth: 6 });
    return text.split(secret).join(label);
  };
  for (const level of ["log", "warn", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => original(...args.map(redact));
  }
}
