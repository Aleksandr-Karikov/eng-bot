import { describe, expect, it, vi } from "vitest";
import { ProviderRouter } from "../src/llm/provider";
import type { LlmBackend } from "../src/llm/backend";
import { withLang } from "../src/lang";
import { modelsFor, OPENROUTER_MODEL_HINT, type ModelSets } from "../src/llm/models";

const MODELS: ModelSets = {
  claudeCode: { main: "haiku", mnemonic: "sonnet", check: "opus" },
  openrouter: { main: "anthropic/claude-haiku-5.5", mnemonic: "anthropic/claude-sonnet-5.5", check: "" },
};

// Ответы настоящие (методы разбирают JSON), иначе тест проверял бы парсер, а не роутер.
const CARD = { translation: "берег", explanation: "Край земли у воды.", example: "The river bank." };
const CHECK = { corrected: "I went home", fixes: [], natural: "" };

/** Бэкенд-запись: собирает запросы, отвечает по ключевому слову промпта. */
function recording(): LlmBackend & { calls: Array<{ prompt: string; model: string; lang: string }> } {
  const calls: Array<{ prompt: string; model: string; lang: string }> = [];
  return {
    name: "recording",
    calls,
    async ask(prompt, _timeoutMs, model, _images, lang) {
      calls.push({ prompt, model, lang: lang.code });
      return prompt.includes("Проверь") ? JSON.stringify(CHECK) : JSON.stringify(CARD);
    },
  };
}

function router(opts: { claudeCode?: LlmBackend; openRouter?: LlmBackend; provider?: "claude-code" | "openrouter" } = {}) {
  return new ProviderRouter({ models: MODELS, timeoutMs: 1_000, ...opts });
}

describe("modelsFor", () => {
  it("keeps the Claude Code aliases as they are", () => {
    expect(modelsFor("claude-code", MODELS)).toEqual({ main: "haiku", mnemonic: "sonnet", check: "opus" });
  });

  it("fills the empty OpenRouter slots with its main model", () => {
    // Три переменные там, где хватает одной: незаданные mnemonic/check — это та же основная модель.
    expect(modelsFor("openrouter", MODELS)).toEqual({
      main: "anthropic/claude-haiku-5.5",
      mnemonic: "anthropic/claude-sonnet-5.5",
      check: "anthropic/claude-haiku-5.5",
    });
  });

  it("keeps the main model empty when it is not configured", () => {
    const empty = modelsFor("openrouter", { claudeCode: MODELS.claudeCode, openrouter: { main: "", mnemonic: "", check: "" } });
    expect(empty.main).toBe("");
  });
});

describe("ProviderRouter", () => {
  it("starts on Claude Code and answers through its backend", async () => {
    const claudeCode = recording();
    const openRouter = recording();
    const llm = router({ claudeCode, openRouter });

    expect(llm.provider).toBe("claude-code");
    expect(await llm.enrich("bank")).toMatchObject({ translation: "берег" });
    expect(claudeCode.calls).toHaveLength(1);
    expect(openRouter.calls).toHaveLength(0);
  });

  it("sends each provider its own model names", async () => {
    // Алиас haiku и имя anthropic/claude-haiku-5.5 — из разных пространств, подменять их нельзя.
    const claudeCode = recording();
    const openRouter = recording();
    const llm = router({ claudeCode, openRouter });

    await llm.check("I goed home");
    expect(claudeCode.calls[0].model).toBe("opus");

    llm.use("openrouter");
    await llm.check("I goed home");
    // check у OpenRouter не задан — значит, основная модель, а не пустая строка.
    expect(openRouter.calls[0].model).toBe("anthropic/claude-haiku-5.5");
    expect(openRouter.calls[0].prompt).toBe(claudeCode.calls[0].prompt);
  });

  it("switches on the fly and reports the previous provider", async () => {
    const claudeCode = recording();
    const openRouter = recording();
    const llm = router({ claudeCode, openRouter });

    expect(llm.use("openrouter")).toBe("claude-code");
    expect(llm.provider).toBe("openrouter");
    await llm.enrich("bank");
    expect(openRouter.calls).toHaveLength(1);
    expect(claudeCode.calls).toHaveLength(0);

    expect(llm.use("claude-code")).toBe("openrouter");
    expect(llm.provider).toBe("claude-code");
  });

  it("runs a request that started before the switch to completion on the old provider", async () => {
    // Смысл переключения «на лету»: начатые запросы не рвутся, следующий уходит уже в нового.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: LlmBackend = { name: "slow", ask: async () => (await gate, JSON.stringify(CARD)) };
    const openRouter = recording();
    const llm = router({ claudeCode: slow, openRouter });

    const inFlight = llm.enrich("bank");
    llm.use("openrouter");
    release();
    expect(await inFlight).toMatchObject({ translation: "берег" });

    await llm.enrich("bank");
    expect(openRouter.calls).toHaveLength(1);
  });

  it("reports OpenRouter as unavailable without a backend and refuses to switch to it", () => {
    const llm = router();
    expect(llm.openRouterReady).toBe(false);
    expect(() => llm.use("openrouter")).toThrow(/OPEN_ROUTER_API_KEY/);
    // Отказ не должен менять состояние: остались там, где были.
    expect(llm.provider).toBe("claude-code");
  });

  it("returns the reason instead of throwing when the switch cannot happen", () => {
    const llm = router();
    const result = llm.tryUse("openrouter");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/OPEN_ROUTER_API_KEY/);
    expect(llm.provider).toBe("claude-code");
  });

  it("treats a key without a model name as not configured", () => {
    // Ключ есть, а имени модели нет: запрос ушёл бы пустым и вернул непонятную ошибку от OpenRouter.
    const openRouter = recording();
    const llm = new ProviderRouter({
      models: { ...MODELS, openrouter: { main: "", mnemonic: "", check: "" } },
      timeoutMs: 1_000,
      openRouter,
    });
    expect(llm.openRouterReady).toBe(false);
    const result = llm.tryUse("openrouter");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/OPENROUTER_MODEL/);
    expect(openRouter.calls).toHaveLength(0);
  });

  it("tells the caller about a successful switch so the choice can be saved", () => {
    const onSwitch = vi.fn();
    const llm = router({ openRouter: recording() });
    llm.onSwitch = onSwitch;

    llm.use("openrouter");
    expect(onSwitch).toHaveBeenCalledWith("openrouter");
    // Повторный выбор того же провайдера — не событие: писать файл незачем.
    llm.use("openrouter");
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("keeps the English prompt identical for both providers", async () => {
    const claudeCode = recording();
    const openRouter = recording();
    const llm = router({ claudeCode, openRouter });
    await llm.enrich("gorgeous");
    llm.use("openrouter");
    await llm.enrich("gorgeous");
    expect(openRouter.calls[0].prompt).toBe(claudeCode.calls[0].prompt);
  });

  it("carries the operation language into the backend", async () => {
    const backend = recording();
    const llm = router({ openRouter: backend, provider: "openrouter" });
    await withLang("ko", () => llm.enrich("사과"));
    expect(backend.calls[0].lang).toBe("ko");
  });

  it("fails clearly when a request reaches an unconfigured OpenRouter", async () => {
    // Такого не должно случаться (use() не пускает), но если состояние перевели руками — ошибка понятная.
    const llm = new ProviderRouter({ models: MODELS, timeoutMs: 1_000, provider: "openrouter" });
    await expect(llm.enrich("bank")).rejects.toThrow("OpenRouter не настроен");
  });
});

describe("OPENROUTER_MODEL_HINT", () => {
  it("points at the variable a person has to set", () => {
    expect(OPENROUTER_MODEL_HINT).toContain("OPENROUTER_MODEL");
  });
});
