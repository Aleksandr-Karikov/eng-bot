export interface Config {
  botToken: string;
  dbPath: string;
  enrichModel: string;
  enrichTimeoutMs: number;
  /** Модель для запоминалок (сильнее основной). */
  mnemonicModel: string;
  /** Путь к mflux-generate, если картинки включены (IMAGES_ENABLED=1). */
  mfluxBin?: string;
  /** Стиль картинок; не задан — по умолчанию (чернильный комикс). */
  imageStyle?: string;
  /** Рисовать картинки заранее в фоне (если картинки включены). IMAGES_BACKGROUND=0 — только по кнопке. */
  imagesBackground: boolean;
  /** Путь к yt-dlp для субтитров YouTube; нет файла — ссылки на YouTube не разбираются. */
  ytdlpBin: string;
  /** Браузер, из которого yt-dlp возьмёт вход в YouTube (YTDLP_COOKIES_BROWSER=safari), если без него не пускают. */
  ytdlpCookiesBrowser?: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const botToken = env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN is not set (see .env.example)");
  return {
    botToken,
    dbPath: env.DB_PATH || "data/eng-bot.sqlite",
    enrichModel: env.ENRICH_MODEL || "haiku",
    enrichTimeoutMs: Number(env.ENRICH_TIMEOUT_MS || 30_000),
    mnemonicModel: env.MNEMONIC_MODEL || "sonnet",
    ...(env.IMAGES_ENABLED === "1" ? { mfluxBin: env.MFLUX_BIN || "tools/imagegen/.venv/bin/mflux-generate" } : {}),
    ...(env.IMAGE_STYLE ? { imageStyle: env.IMAGE_STYLE } : {}),
    imagesBackground: env.IMAGES_ENABLED === "1" && env.IMAGES_BACKGROUND !== "0",
    ytdlpBin: env.YTDLP_BIN || "tools/ytdlp/.venv/bin/yt-dlp",
    ...(env.YTDLP_COOKIES_BROWSER ? { ytdlpCookiesBrowser: env.YTDLP_COOKIES_BROWSER } : {}),
  };
}
