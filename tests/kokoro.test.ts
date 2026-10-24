import { afterEach, describe, expect, it, vi } from "vitest";
import { KokoroSynth, type SpeechSynth } from "../src/speech/tts";

const fallback = (): SpeechSynth & { synthesize: ReturnType<typeof vi.fn> } => ({ synthesize: vi.fn(async () => Buffer.from("say")) });
let synth: KokoroSynth | undefined;
afterEach(() => synth?.close());

describe("🔊 Kokoro voices", () => {
  it("speaks through one long-lived worker, in Telegram's and the browser's formats", async () => {
    const say = fallback();
    synth = new KokoroSynth(process.execPath, "tests/fixtures/fake-kokoro.mjs", say);
    const ogg = await synth.synthesize("cramp your style", "uk", "ogg");
    const m4a = await synth.synthesize("cramp your style", "us", "m4a");
    expect(ogg.subarray(0, 4).toString()).toBe("OggS");
    expect(m4a.subarray(4, 8).toString()).toBe("ftyp");
    expect(say.synthesize).not.toHaveBeenCalled();
  });

  it("a phrase it can't say, or a crashed worker, falls back to the old voice — and the worker comes back", async () => {
    const say = fallback();
    synth = new KokoroSynth(process.execPath, "tests/fixtures/fake-kokoro.mjs", say);
    expect((await synth.synthesize("fail", "uk")).toString()).toBe("say");
    expect((await synth.synthesize("crash", "uk")).toString()).toBe("say");
    expect((await synth.synthesize("hello", "uk")).subarray(0, 4).toString()).toBe("OggS");
    expect(say.synthesize).toHaveBeenCalledTimes(2);
  });
});

describe("worker that cannot start", () => {
  it("a missing python does not crash the process — the phrase falls back to say", async () => {
    const said: string[] = [];
    const fallback: SpeechSynth = { synthesize: async (text) => (said.push(text), Buffer.from("say")) };
    const broken = new KokoroSynth("/nonexistent/python", "x.py", fallback);
    expect((await broken.synthesize("hi", "uk")).toString()).toBe("say");
    expect(said).toEqual(["hi"]);
    broken.close();
  });
});
