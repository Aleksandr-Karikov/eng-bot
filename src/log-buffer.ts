/** Последние предупреждения и ошибки бота в памяти — прикладываются к /bug. Ставить после redactLogs (без токена). */
const MAX_LINES = 30;
const lines: string[] = [];

export function captureRecentLogs(target: Pick<Console, "warn" | "error"> = console): void {
  for (const level of ["warn", "error"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      lines.push(`${new Date().toISOString()} ${level}: ${args.map(String).join(" ").slice(0, 800)}`);
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      original(...args);
    };
  }
}

export const recentLogs = (): string[] => [...lines];
