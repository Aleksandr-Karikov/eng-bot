export interface Config {
  botToken: string;
  dbPath: string;
  enrichModel: string;
  enrichTimeoutMs: number;
  /** Модель для запоминалок (сильнее основной). */
  mnemonicModel: string;
  /** Модель для проверок: /check, ответы в упражнениях, перевод. */
  checkModel: string;
  /** Путь к mflux-generate, если картинки рисует локальный FLUX. */
  mfluxBin?: string;
  /** Ключ и модель внешней рисовалки; заданы — картинки рисует API, а не локальный FLUX. */
  imageApiKey?: string;
  imageModel?: string;
  /** Стиль картинок; не задан — по умолчанию (чернильный комикс). */
  imageStyle?: string;
  /** Рисовать картинки заранее в фоне (если картинки включены). IMAGES_BACKGROUND=0 — только по кнопке. */
  imagesBackground: boolean;
  /** Python с youtube-transcript-api для субтитров YouTube; нет файла — ссылки на YouTube не разбираются. */
  youtubePython: string;
  /** Порт Mini App (наружу — через ngrok); 0 — выключить. */
  appPort: number;
  /** Публичный HTTPS-адрес Mini App (например, https://xxx.ngrok-free.app/app/) — для кнопки «Учить» в боте. */
  appUrl?: string;
  /** Telegram id того, кто чинит бота: ему приходят новые /bug. */
  adminTelegramId?: number;
  /** Python с wordfreq — частотность слов для оценки полезности. */
  wordfreqPython: string;
  /** Python с Kokoro (tools/tts); нет такого файла — озвучка встроенным голосом macOS. */
  ttsPython: string;
  /** Python с распознаванием речи (tools/stt); нет такого файла — голосовые не распознаются. */
  sttPython: string;
  /** Порт локального приёма слов из расширения браузера; CAPTURE_PORT=0 — выключить. */
  capturePort: number;
  /** Ключ OpenRouter; нет ключа — провайдер недоступен, работает только Claude Code. */
  openRouterKey?: string;
  /** Модели OpenRouter (полные имена вида anthropic/claude-haiku-5.5); main пустой — не настроено. */
  openRouterModel?: string;
  openRouterMnemonicModel?: string;
  openRouterCheckModel?: string;
  /** С какого провайдера начинать; переключается на лету командой /llm или scripts/llm.ts. */
  llmProvider: "claude-code" | "openrouter";
  /**
   * Где помнить выбранного провайдера между перезапусками.
   * Нужно ради /llm в боте: CLI-переключатель и так меняет .env, а бот .env не переписывает.
   */
  llmProviderFile: string;
}

/** Опечатка в .env (NaN) не должна превращаться в таймаут 0 — он отменял бы каждый запрос к Claude. */
function positiveNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const botToken = env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN is not set (see .env.example)");
  return {
    botToken,
    dbPath: env.DB_PATH || "data/eng-bot.sqlite",
    enrichModel: env.ENRICH_MODEL || "haiku",
    enrichTimeoutMs: positiveNumber(env.ENRICH_TIMEOUT_MS, 30_000),
    mnemonicModel: env.MNEMONIC_MODEL || "sonnet",
    checkModel: env.CHECK_MODEL || "sonnet",
    // Картинки: включены — рисует либо внешний API (есть ключ), либо локальный FLUX.
    // Ключ API важнее: на Linux локальный MLX всё равно не заведётся, и выбор должен быть явным.
    ...(env.IMAGES_ENABLED === "1"
      ? {
          ...(env.IMAGE_API_KEY
            ? { imageApiKey: env.IMAGE_API_KEY, imageModel: env.IMAGE_MODEL || "google/gemini-3.1-flash-lite-image" }
            : { mfluxBin: env.MFLUX_BIN || "tools/imagegen/.venv/bin/mflux-generate" }),
        }
      : {}),
    ...(env.IMAGE_STYLE ? { imageStyle: env.IMAGE_STYLE } : {}),
    imagesBackground:
      env.IMAGES_ENABLED === "1" && env.IMAGES_BACKGROUND !== "0",
    youtubePython: env.YOUTUBE_PYTHON || "tools/youtube/.venv/bin/python",
    capturePort: Number(env.CAPTURE_PORT ?? 8787),
    wordfreqPython: env.WORDFREQ_PYTHON || "tools/wordfreq/.venv/bin/python",
    ttsPython: env.TTS_PYTHON || "tools/tts/.venv/bin/python",
    sttPython: env.STT_PYTHON || "tools/stt/.venv/bin/python",
    appPort: Number(env.APP_PORT ?? 8788),
    ...(env.APP_URL ? { appUrl: env.APP_URL } : {}),
    ...(Number(env.ADMIN_TELEGRAM_ID) > 0 ? { adminTelegramId: Number(env.ADMIN_TELEGRAM_ID) } : {}),
    ...(env.OPEN_ROUTER_API_KEY ? { openRouterKey: env.OPEN_ROUTER_API_KEY } : {}),
    ...(env.OPENROUTER_MODEL ? { openRouterModel: env.OPENROUTER_MODEL } : {}),
    ...(env.OPENROUTER_MNEMONIC_MODEL ? { openRouterMnemonicModel: env.OPENROUTER_MNEMONIC_MODEL } : {}),
    ...(env.OPENROUTER_CHECK_MODEL ? { openRouterCheckModel: env.OPENROUTER_CHECK_MODEL } : {}),
    // Провайдер по умолчанию — Claude Code: он работает без ключа и так было всегда.
    llmProvider: env.LLM_PROVIDER === "openrouter" ? "openrouter" : "claude-code",
    llmProviderFile: env.LLM_PROVIDER_FILE || "data/llm-provider",
  };
}
