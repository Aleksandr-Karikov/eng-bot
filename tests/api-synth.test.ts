import { describe, expect, it, vi } from "vitest";
import { ApiSynth } from "../src/images/images";

/** Картинка так, как её отдаёт OpenRouter: data-URL внутри choices[0].message.images. */
const picture = (data = Buffer.from("jpeg-bytes")) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { images: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.toString("base64")}` } }] } }],
  }),
});

function setup(responses: Array<unknown>, opts: { title?: string; referer?: string; timeoutMs?: number } = {}) {
  const fetchImpl = vi.fn(async () => responses.shift() as never) as unknown as typeof fetch;
  const synth = new ApiSynth({
    apiKey: "sk-or-test",
    model: "google/gemini-3.1-flash-lite-image",
    title: opts.title,
    referer: opts.referer,
    timeoutMs: opts.timeoutMs,
    fetchImpl,
  });
  const body = () => JSON.parse((fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body as string);
  const init = () => (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1];
  return { synth, fetchImpl, body, init };
}

describe("ApiSynth", () => {
  it("asks for a picture, not for text, and returns the decoded bytes", async () => {
    const { synth, body, init } = setup([picture(Buffer.from("real-jpeg"))]);
    expect(await synth.draw("a red apple")).toEqual(Buffer.from("real-jpeg"));
    expect(body().model).toBe("google/gemini-3.1-flash-lite-image");
    // Без modalities модель отвечает описанием вместо картинки — это и есть запрос «нарисуй».
    expect(body().modalities).toEqual(["image", "text"]);
    expect(body().messages).toEqual([{ role: "user", content: "a red apple" }]);
    expect((init().headers as Record<string, string>).authorization).toBe("Bearer sk-or-test");
  });

  it("decodes the data-URL into a buffer, not into a string", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { synth } = setup([picture(bytes)]);
    const out = await synth.draw("x");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.equals(bytes)).toBe(true);
  });

  it("sends attribution headers only when asked", async () => {
    const bare = setup([picture()]);
    await bare.synth.draw("x");
    expect(bare.init().headers).not.toHaveProperty("X-Title");

    const titled = setup([picture()], { title: "WordBoss", referer: "https://example.test" });
    await titled.synth.draw("x");
    expect(titled.init().headers).toMatchObject({ "X-Title": "WordBoss", "HTTP-Referer": "https://example.test" });
  });

  it("surfaces the provider's own explanation on a non-OK answer", async () => {
    // 402 — кончился баланс: это чинится настройкой, а не повтором, и должно быть видно в логе как есть.
    const { synth } = setup([{ ok: false, status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) }]);
    await expect(synth.draw("x")).rejects.toThrow("Image API failed: Insufficient credits");
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const { synth } = setup([{ ok: false, status: 502, json: async () => Promise.reject(new Error("not json")) }]);
    await expect(synth.draw("x")).rejects.toThrow("Image API failed: HTTP 502");
  });

  it("treats a 200 without a picture as a failure, not as an empty buffer", async () => {
    // Модель отвечает текстом вместо картинки, когда промпт читается как «опиши», а не «нарисуй».
    // Пустой буфер ушёл бы в Telegram битым файлом, поэтому это ошибка — и в ней видно, что ответила модель.
    const text = setup([
      { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "I cannot draw that" } }] }) },
    ]);
    await expect(text.synth.draw("x")).rejects.toThrow(/no picture, it answered with text: I cannot draw that/);

    const empty = setup([{ ok: true, status: 200, json: async () => ({ choices: [], error: { message: "no providers" } }) }]);
    await expect(empty.synth.draw("x")).rejects.toThrow("Image API returned no picture");
  });

  it("rejects instead of hanging when the picture takes too long", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const synth = new ApiSynth({ apiKey: "sk-or-test", model: "m", timeoutMs: 10, fetchImpl });
    await expect(synth.draw("долго")).rejects.toThrow("aborted");
  });
});
