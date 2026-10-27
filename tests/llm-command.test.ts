import { describe, expect, it, vi } from "vitest";
import { botHarness } from "./bot-harness";
import type { LlmSwitch } from "../src/bot/context";
import type { Provider } from "../src/llm/provider";

const ADMIN = 999;
const STRANGER = 555;

/** Провайдер, который помнит переключения и умеет отказывать так же, как настоящий роутер. */
function switcher(opts: { provider?: Provider; ready?: boolean } = {}) {
  let provider = opts.provider ?? "claude-code";
  const use = vi.fn((target: Provider) => {
    if (target === "openrouter" && !(opts.ready ?? true)) {
      throw new Error("OpenRouter не настроен: нужны OPEN_ROUTER_API_KEY и OPENROUTER_MODEL в .env");
    }
    const previous = provider;
    provider = target;
    return previous;
  });
  return {
    use,
    get provider(): string {
      return provider;
    },
    get openRouterReady(): boolean {
      return opts.ready ?? true;
    },
  } satisfies LlmSwitch & { use: typeof use };
}

const lastText = (h: ReturnType<typeof botHarness>) => {
  const calls = h.calls.filter((c) => c.method === "sendMessage");
  return String(calls[calls.length - 1]?.payload.text ?? "");
};

describe("/llm", () => {
  it("shows the current provider to the admin", async () => {
    const h = botHarness({ adminTelegramId: ADMIN, llm: switcher() });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm"));
    expect(lastText(h)).toContain("Claude Code");
    expect(lastText(h)).toContain("/llm openrouter");
  });

  it("switches the provider and says what it was", async () => {
    const llm = switcher();
    const h = botHarness({ adminTelegramId: ADMIN, llm });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm openrouter"));

    expect(llm.use).toHaveBeenCalledWith("openrouter");
    expect(llm.provider).toBe("openrouter");
    expect(lastText(h)).toContain("OpenRouter");
    expect(lastText(h)).toContain("Было: Claude Code");
  });

  it("switches back to Claude Code", async () => {
    const llm = switcher({ provider: "openrouter" });
    const h = botHarness({ adminTelegramId: ADMIN, llm });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm claude-code"));

    expect(llm.provider).toBe("claude-code");
    expect(lastText(h)).toContain("Claude Code");
  });

  it("does not switch on an unknown provider and shows the usage", async () => {
    const llm = switcher();
    const h = botHarness({ adminTelegramId: ADMIN, llm });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm gpt"));

    expect(llm.use).not.toHaveBeenCalled();
    expect(lastText(h)).toContain("Не знаю провайдера");
    expect(lastText(h)).toContain("/llm openrouter");
  });

  it("does not let the argument break the HTML markup", async () => {
    // Аргумент — текст от человека, а сообщение уходит с parse_mode HTML: без esc() Telegram отклонит его.
    const h = botHarness({ adminTelegramId: ADMIN, llm: switcher() });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm <b>жирный"));

    expect(lastText(h)).toContain("&lt;b&gt;");
    expect(lastText(h)).not.toContain("<b>жирный");
  });

  it("explains what is missing when OpenRouter is not configured", async () => {
    // Отказ — часть работы: в сообщении должно быть видно, какую переменную добавить.
    const llm = switcher({ ready: false });
    const h = botHarness({ adminTelegramId: ADMIN, llm });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm openrouter"));

    expect(llm.provider).toBe("claude-code");
    expect(lastText(h)).toContain("OPEN_ROUTER_API_KEY");
  });

  it("reports OpenRouter as unavailable in the status when it is not configured", async () => {
    const h = botHarness({ adminTelegramId: ADMIN, llm: switcher({ ready: false }) });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm"));
    expect(lastText(h)).toContain("не настроен");
  });

  it("is admin-only", async () => {
    const llm = switcher();
    const h = botHarness({ adminTelegramId: ADMIN, llm });
    await h.bot.handleUpdate(h.message(STRANGER, "/llm openrouter"));

    expect(llm.use).not.toHaveBeenCalled();
    expect(llm.provider).toBe("claude-code");
    expect(lastText(h)).toContain("только для админа");
  });

  it("says nothing to a non-admin when no admin is configured at all", async () => {
    const llm = switcher();
    const h = botHarness({ llm });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm"));

    expect(llm.use).not.toHaveBeenCalled();
    expect(lastText(h)).toContain("только для админа");
  });

  it("answers without breaking when the switch is not wired in", async () => {
    const h = botHarness({ adminTelegramId: ADMIN });
    await h.bot.handleUpdate(h.message(ADMIN, "/llm"));
    expect(lastText(h)).toContain("не собрана");
  });
});
