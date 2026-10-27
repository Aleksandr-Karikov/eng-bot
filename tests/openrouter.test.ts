import { describe, expect, it, vi } from "vitest";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { LANGUAGES } from "../src/lang";

/** Ответ OpenAI-совместимого API в том виде, в каком его ждёт бэкенд. */
const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

function setup(responses: Array<unknown>, opts: { apiKey?: string; title?: string; referer?: string } = {}) {
  const fetchImpl = vi.fn(async () => responses.shift() as never) as unknown as typeof fetch;
  const backend = new OpenRouterBackend({ apiKey: opts.apiKey ?? "sk-or-test", title: opts.title, referer: opts.referer, fetchImpl });
  const body = () => JSON.parse((fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body as string);
  const init = () => (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
  return { backend, fetchImpl, body, init };
}

const ask = (backend: OpenRouterBackend, prompt = "переведи bank", images: Parameters<OpenRouterBackend["ask"]>[3] = [], model = "anthropic/claude-haiku-5.5") =>
  backend.ask(prompt, 5_000, model, images, LANGUAGES.en);

describe("OpenRouterBackend", () => {
  it("sends the model, the key and the system prompt, and returns the answer", async () => {
    const { backend, body, init } = setup([reply("берег")]);
    expect(await ask(backend)).toBe("берег");
    expect(body().model).toBe("anthropic/claude-haiku-5.5");
    expect((init().headers as Record<string, string>).authorization).toBe("Bearer sk-or-test");
    // Системный промпт у OpenRouter — отдельным сообщением, а не параметром, как у Claude Code.
    const [system, user] = body().messages;
    expect(system.role).toBe("system");
    expect(system.content.length).toBeGreaterThan(0);
    expect(user).toMatchObject({ role: "user", content: "переведи bank" });
  });

  it("sends attribution headers only when asked", async () => {
    const bare = setup([reply("x")]);
    await ask(bare.backend);
    expect(bare.init().headers).not.toHaveProperty("X-Title");

    const titled = setup([reply("x")], { title: "WordBoss", referer: "https://example.test" });
    await ask(titled.backend);
    expect(titled.init().headers).toMatchObject({ "X-Title": "WordBoss", "HTTP-Referer": "https://example.test" });
  });

  it("passes images as data-URLs in the content array", async () => {
    const { backend, body } = setup([reply("ok")]);
    const image = { data: Buffer.from("png-bytes"), mediaType: "image/png" as const };
    expect(await ask(backend, "что тут написано", [image])).toBe("ok");
    expect(body().messages[1].content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.data.toString("base64")}` } },
      { type: "text", text: "что тут написано" },
    ]);
  });

  it("surfaces the provider's own explanation on a non-OK answer", async () => {
    const { backend } = setup([
      { ok: false, status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) },
    ]);
    await expect(ask(backend)).rejects.toThrow("OpenRouter failed: Insufficient credits");
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const { backend } = setup([{ ok: false, status: 502, json: async () => Promise.reject(new Error("not json")) }]);
    await expect(ask(backend)).rejects.toThrow("OpenRouter failed: HTTP 502");
  });

  it("treats an empty choice as a failure with the reason, not as an empty answer", async () => {
    // 200 с пустым content и пояснением — так OpenRouter отвечает, когда модель отказалась отвечать.
    const { backend } = setup([{ ok: true, status: 200, json: async () => ({ choices: [], error: { message: "no providers" } }) }]);
    await expect(ask(backend)).rejects.toThrow("OpenRouter returned no answer: no providers");

    const empty = setup([{ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] }) }]);
    await expect(ask(empty.backend)).rejects.toThrow("OpenRouter returned no answer: empty answer");
  });

  it("rejects instead of hanging when the answer takes too long", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const backend = new OpenRouterBackend({ apiKey: "sk-or-test", fetchImpl });
    await expect(backend.ask("долго", 10, "m", [], LANGUAGES.en)).rejects.toThrow("aborted");
  });
});
