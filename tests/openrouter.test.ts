import { describe, expect, it, vi } from "vitest";
import { OpenRouterBackend } from "../src/llm/openrouter";
import { EN } from "../src/lang";

/** Ответ OpenAI-совместимого API в том виде, в каком его ждёт бэкенд. */
const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

function setup(responses: Array<unknown>, opts: { apiKey?: string; title?: string; referer?: string } = {}) {
  const fetchImpl = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response as never;
  }) as unknown as typeof fetch;
  const backend = new OpenRouterBackend({ apiKey: opts.apiKey ?? "sk-or-test", title: opts.title, referer: opts.referer, fetchImpl });
  const body = () => JSON.parse((fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body as string);
  const init = () => (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
  return { backend, fetchImpl, body, init };
}

const ask = (backend: OpenRouterBackend, prompt = "переведи bank", images: Parameters<OpenRouterBackend["ask"]>[3] = [], model = "anthropic/claude-haiku-5.5") =>
  backend.ask(prompt, 5_000, model, images, EN);

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
    const { backend, fetchImpl } = setup([
      { ok: false, status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) },
    ]);
    await expect(ask(backend)).rejects.toMatchObject({ message: "OpenRouter failed: Insufficient credits", code: "http_402" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const response = { ok: false, status: 502, json: async () => Promise.reject(new Error("not json")) };
    const { backend, fetchImpl } = setup([response, response]);
    await expect(ask(backend)).rejects.toMatchObject({ message: "OpenRouter failed: HTTP 502", code: "http_502" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats an empty choice as a failure with the reason, not as an empty answer", async () => {
    // 200 с пустым content и пояснением — так OpenRouter отвечает, когда модель отказалась отвечать.
    const { backend } = setup([{ ok: true, status: 200, json: async () => ({ choices: [], error: { message: "no providers" } }) }]);
    await expect(ask(backend)).rejects.toThrow("OpenRouter returned no answer: no providers");

    const { backend: empty, fetchImpl } = setup([reply(""), reply("")]);
    await expect(ask(empty)).rejects.toMatchObject({ code: "empty_reply" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    new TypeError("network down"),
    new Response('{"error":{"code":503}}', { status: 503 }),
    new Response('{"error":{"code":502}}', { status: 200 }),
    new Response('{"error":{"code":402,"metadata":{"reason":"in_flight_budget_exhausted"}}}', { status: 402 }),
  ])("recovers once after a temporary provider or network failure", async (failure) => {
    const { backend, fetchImpl, init } = setup([failure, reply("берег")]);
    expect(await ask(backend)).toBe("берег");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith("https://openrouter.ai/api/v1/chat/completions", init());
  });

  it("does not retry when Retry-After does not fit the original timeout", async () => {
    const { backend, fetchImpl } = setup([new Response('{"error":{"code":429}}', {
      status: 429, headers: { "Retry-After": "30" },
    })]);
    await expect(ask(backend)).rejects.toMatchObject({ code: "http_429", retryAfterMs: 30_000 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not retry an explicit filter and preserves a partial response cut by the token limit", async () => {
    const filtered = setup([new Response('{"choices":[{"finish_reason":"content_filter","message":{"content":""}}]}')]);
    await expect(ask(filtered.backend)).rejects.toMatchObject({ code: "content_filter" });
    expect(filtered.fetchImpl).toHaveBeenCalledOnce();
    const partial = setup([new Response('{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}')]);
    expect(await ask(partial.backend)).toBe("partial");
    expect(partial.fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects instead of hanging when the answer takes too long", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const backend = new OpenRouterBackend({ apiKey: "sk-or-test", fetchImpl });
    await expect(backend.ask("долго", 10, "m", [], EN)).rejects.toThrow("aborted");
  });
});
