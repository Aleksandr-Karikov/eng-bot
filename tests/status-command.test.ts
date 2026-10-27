import { describe, expect, it } from "vitest";
import { botHarness } from "./bot-harness";
import type { BotStatus } from "../src/bot/context";

const ADMIN = 999;
const STRANGER = 555;

/** Состояние, каким его собирает src/index.ts: рисует API, фон выключен. */
function status(overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    startedAt: new Date(0),
    llm: {
      provider: "openrouter",
      openRouterReady: true,
      use: () => "openrouter",
    },
    models: { main: "google/gemini-2.5-flash-lite", mnemonic: "google/gemini-2.5-flash-lite", check: "anthropic/claude-haiku-5.5" },
    images: { synth: "api", model: "google/gemini-3.1-flash-lite-image", background: false, style: "watercolor storybook illustration" },
    secrets: { openRouter: true, imageApi: true },
    tools: { tts: "Kokoro (нейросетевые голоса)", stt: true, youtube: true, frequency: true },
    app: { port: 8788, urlSet: true, capturePort: 8787 },
    ...overrides,
  };
}

const lastText = (h: ReturnType<typeof botHarness>) => {
  const calls = h.calls.filter((c) => c.method === "sendMessage");
  return String(calls[calls.length - 1]?.payload.text ?? "");
};

const ask = async (s: BotStatus, from = ADMIN) => {
  const h = botHarness({ adminTelegramId: ADMIN, status: s });
  await h.bot.handleUpdate(h.message(from, "/status"));
  return lastText(h);
};

describe("/status", () => {
  it("shows the admin what the bot is actually running", async () => {
    const text = await ask(status());
    expect(text).toContain("OpenRouter");
    expect(text).toContain("google/gemini-3.1-flash-lite-image");
    expect(text).toContain("watercolor");
    expect(text).toContain("8788");
  });

  it("says the background painter is off, in words", async () => {
    // Ради этой строки команда в основном и нужна: фон — главный расход на платном API.
    expect(await ask(status())).toContain("выключена (только по кнопке)");
    const on = await ask(status({ images: { synth: "api", model: "m", background: true, style: "s" } }));
    expect(on).toContain("включена");
  });

  it("never prints a key, only whether it is set", async () => {
    // Ключей нет в BotStatus вовсе, поэтому проверяем и обратное: «задан» без значения.
    const text = await ask(status());
    expect(text).toContain("OpenRouter: да");
    expect(text).not.toMatch(/sk-or-|sk-[A-Za-z0-9]{10}/);
    // А если ключа нет — честное «нет», а не пустая строка.
    const none = await ask(status({ secrets: { openRouter: false, imageApi: false } }));
    expect(none).toContain("OpenRouter: нет");
  });

  it("tells the admin which provider is the fallback and whether it is usable", async () => {
    const notReady = await ask(
      status({ llm: { provider: "claude-code", openRouterReady: false, use: () => "claude-code" } }),
    );
    expect(notReady).toContain("Claude Code");
    expect(notReady).toContain("не настроен");
  });

  it("reports pictures as off when there is no synth at all", async () => {
    const text = await ask(status({ images: { synth: "off", background: false, style: "s" } }));
    expect(text).toContain("Выключены целиком");
  });

  it("keeps the command to the admin", async () => {
    expect(await ask(status(), STRANGER)).toBe("Команда только для админа.");
  });

  it("says so instead of breaking when the state is not wired", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    await h.bot.handleUpdate(h.message(ADMIN, "/status"));
    expect(lastText(h)).toContain("не собрано");
  });

  it("shows how long ago the process started, so a stale bot is visible", async () => {
    // startedAt — эпоха, а T0 харнесса много позже: аптайм должен быть большим, а не «0 мин».
    const text = await ask(status());
    expect(text).toContain("<b>Запущен:</b> 20741 д");
    // Свежий процесс показывает минуты — то есть строку можно прочитать как «только что перезапустился».
    const fresh = await ask(status({ startedAt: new Date("2026-10-15T08:55:00Z") }));
    expect(fresh).toContain("<b>Запущен:</b> 5 мин назад");
  });
});
