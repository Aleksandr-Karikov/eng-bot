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
  /** Python с youtube-transcript-api для субтитров YouTube; нет файла — ссылки на YouTube не разбираются. */
  youtubePython: string;
  /** Python с wordfreq — частотность слов для оценки полезности. */
  wordfreqPython: string;
  /** Порт локального приёма слов из расширения браузера; CAPTURE_PORT=0 — выключить. */
  capturePort: number;
}

/** Опечатка в .env (NaN) не должна превращаться в таймаут 0 — он отменял бы каждый запрос к Claude. */
function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const botToken = env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN is not set (see .env.example)");
  return {
    botToken,
    dbPath: env.DB_PATH || "data/eng-bot.sqlite",
    enrichModel: env.ENRICH_MODEL || "haiku",
    enrichTimeoutMs: positiveNumber(env.ENRICH_TIMEOUT_MS, 30_000),
    mnemonicModel: env.MNEMONIC_MODEL || "sonnet",
    ...(env.IMAGES_ENABLED === "1" ? { mfluxBin: env.MFLUX_BIN || "tools/imagegen/.venv/bin/mflux-generate" } : {}),
    ...(env.IMAGE_STYLE ? { imageStyle: env.IMAGE_STYLE } : {}),
    imagesBackground: env.IMAGES_ENABLED === "1" && env.IMAGES_BACKGROUND !== "0",
    youtubePython: env.YOUTUBE_PYTHON || "tools/youtube/.venv/bin/python",
    capturePort: Number(env.CAPTURE_PORT ?? 8787),
    wordfreqPython: env.WORDFREQ_PYTHON || "tools/wordfreq/.venv/bin/python",
  };
}
