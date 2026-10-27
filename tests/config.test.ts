import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("throws when BOT_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow("BOT_TOKEN");
  });

  it("applies defaults", () => {
    expect(loadConfig({ BOT_TOKEN: "t" })).toEqual({
      botToken: "t",
      dbPath: "data/eng-bot.sqlite",
      enrichModel: "haiku",
      enrichTimeoutMs: 30_000,
      mnemonicModel: "sonnet",
      checkModel: "sonnet",
      imagesBackground: false,
      youtubePython: "tools/youtube/.venv/bin/python",
      capturePort: 8787,
      wordfreqPython: "tools/wordfreq/.venv/bin/python",
      ttsPython: "tools/tts/.venv/bin/python",
      sttPython: "tools/stt/.venv/bin/python",
      appPort: 8788,
      llmProvider: "claude-code",
      llmProviderFile: "data/llm-provider",
    });
  });

  it("ignores a broken timeout instead of cancelling every request", () => {
    expect(loadConfig({ BOT_TOKEN: "t", ENRICH_TIMEOUT_MS: "30s" }).enrichTimeoutMs).toBe(30_000);
  });

  it("reads overrides", () => {
    const config = loadConfig({ BOT_TOKEN: "t", DB_PATH: "x.db", ENRICH_MODEL: "sonnet", ENRICH_TIMEOUT_MS: "5000" });
    expect(config).toMatchObject({ dbPath: "x.db", enrichModel: "sonnet", enrichTimeoutMs: 5000 });
  });

  it("reads the OpenRouter settings, including its own model names", () => {
    const config = loadConfig({
      BOT_TOKEN: "t",
      OPEN_ROUTER_API_KEY: "sk-or-v1-x",
      OPENROUTER_MODEL: "anthropic/claude-haiku-5.5",
      OPENROUTER_MNEMONIC_MODEL: "anthropic/claude-sonnet-5.5",
      LLM_PROVIDER: "openrouter",
      LLM_PROVIDER_FILE: "/tmp/pick",
    });
    expect(config).toMatchObject({
      openRouterKey: "sk-or-v1-x",
      openRouterModel: "anthropic/claude-haiku-5.5",
      openRouterMnemonicModel: "anthropic/claude-sonnet-5.5",
      llmProvider: "openrouter",
      llmProviderFile: "/tmp/pick",
    });
  });

  it("treats an unknown LLM_PROVIDER as the default instead of breaking the start", () => {
    expect(loadConfig({ BOT_TOKEN: "t", LLM_PROVIDER: "gpt" }).llmProvider).toBe("claude-code");
  });

  it("leaves the OpenRouter model unset when it is not configured", () => {
    // У OpenRouter нет имени модели по умолчанию: подставлять устаревшее хуже, чем сказать «задай сам».
    const config = loadConfig({ BOT_TOKEN: "t", OPEN_ROUTER_API_KEY: "sk-or-v1-x" });
    expect(config.openRouterModel).toBeUndefined();
  });

  it("draws pictures with the local FLUX when no API key is given", () => {
    expect(loadConfig({ BOT_TOKEN: "t", IMAGES_ENABLED: "1" })).toMatchObject({
      mfluxBin: "tools/imagegen/.venv/bin/mflux-generate",
    });
  });

  it("prefers the image API over the local FLUX when both are configured", () => {
    // На Linux локальный MLX не заведётся: ключ должен побеждать, а не молча проигрывать FLUX.
    const config = loadConfig({ BOT_TOKEN: "t", IMAGES_ENABLED: "1", IMAGE_API_KEY: "sk-or-v1-x" });
    expect(config.imageApiKey).toBe("sk-or-v1-x");
    expect(config.imageModel).toBe("google/gemini-3.1-flash-lite-image");
    expect(config.mfluxBin).toBeUndefined();
  });

  it("does not turn pictures on just because a key is present", () => {
    // IMAGES_ENABLED — выключатель: ключ без него не должен начать тратить деньги.
    const config = loadConfig({ BOT_TOKEN: "t", IMAGE_API_KEY: "sk-or-v1-x" });
    expect(config.imageApiKey).toBeUndefined();
    expect(config.mfluxBin).toBeUndefined();
    expect(config.imagesBackground).toBe(false);
  });

  it("turns the background painter off with IMAGES_BACKGROUND=0, keeping pictures by button", () => {
    // Фон рисует все слова подряд, не спрашивая: на платном API это главный расход.
    // Выключить его должно быть можно, не выключая картинки целиком.
    const config = loadConfig({ BOT_TOKEN: "t", IMAGES_ENABLED: "1", IMAGE_API_KEY: "sk-or-v1-x", IMAGES_BACKGROUND: "0" });
    expect(config.imagesBackground).toBe(false);
    expect(config.imageApiKey).toBe("sk-or-v1-x");
  });

  it("draws in the background by default, since the local FLUX was free", () => {
    const config = loadConfig({ BOT_TOKEN: "t", IMAGES_ENABLED: "1", IMAGE_API_KEY: "sk-or-v1-x" });
    expect(config.imagesBackground).toBe(true);
  });
});
