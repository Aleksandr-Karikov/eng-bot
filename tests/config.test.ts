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
      imagesBackground: false,
      youtubePython: "tools/youtube/.venv/bin/python",
      capturePort: 8787,
      wordfreqPython: "tools/wordfreq/.venv/bin/python",
    });
  });

  it("reads overrides", () => {
    const config = loadConfig({ BOT_TOKEN: "t", DB_PATH: "x.db", ENRICH_MODEL: "sonnet", ENRICH_TIMEOUT_MS: "5000" });
    expect(config).toMatchObject({ dbPath: "x.db", enrichModel: "sonnet", enrichTimeoutMs: 5000 });
  });
});
