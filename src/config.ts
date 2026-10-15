export interface Config {
  botToken: string;
  dbPath: string;
  enrichModel: string;
  enrichTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const botToken = env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN is not set (see .env.example)");
  return {
    botToken,
    dbPath: env.DB_PATH || "data/eng-bot.sqlite",
    enrichModel: env.ENRICH_MODEL || "haiku",
    enrichTimeoutMs: Number(env.ENRICH_TIMEOUT_MS || 30_000),
  };
}
