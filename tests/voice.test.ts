import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sameWords } from "../src/bot/handlers/pronounce";
import type { TalkInput } from "../src/llm/tutor";
import type { Pronunciation, SpeechRecognizer } from "../src/speech/stt";
import { updateUser } from "../src/services/users";
import { botHarness, buttonData } from "./bot-harness";
import { makeUser } from "./helpers";

const result: Pronunciation = {
  heard: ["s", "o", "d"],
  expected: ["θ", "ɔː", "t"],
  score: 0.2,
  accent: "us",
  diff: [{ op: "replace", expected: ["θ", "ɔː", "t"], heard: ["s", "o", "d"] }],
};

async function setup(transcribe = vi.fn(async () => "I'd like a latte"), samples?: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("ogg-bytes"))));
  const pronunciation = vi.fn(async () => result);
  const recognizer: SpeechRecognizer = { transcribe, pronunciation };
  const talkReply = vi.fn(async (_input: TalkInput) => "Sure, anything else?");
  const synthesize = vi.fn(async () => Buffer.from("ogg"));
  const h = botHarness({ recognizer, voiceSamplesDir: samples, speech: { synthesize } });
  h.deps.tutor.talkReply = talkReply;
  await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  return { h, transcribe, pronunciation, talkReply, synthesize };
}

const texts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

afterEach(() => vi.unstubAllGlobals());

describe("🎙 voice messages", () => {
  it("/talk: a voice reply is recognised, shown back, and the partner answers by voice with the text as caption", async () => {
    const { h, transcribe, talkReply, synthesize } = await setup();
    await h.bot.handleUpdate(h.message(100, "/talk"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "☕ В кафе")));
    await vi.waitFor(() => expect(talkReply).toHaveBeenCalledTimes(1));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendVoice")).toBe(true));
    expect(transcribe).toHaveBeenCalledWith(Buffer.from("ogg-bytes"));
    expect(texts(h)).toContain("🗣 <i>I'd like a latte</i>");
    // Тот же объект разговора: после ответа в конце — реплика собеседника.
    expect(talkReply.mock.calls[1][0].lines.at(-2)).toEqual({ who: "user", text: "I'd like a latte" });
    const voice = h.calls.find((c) => c.method === "sendVoice")!;
    expect(voice.payload.caption).toBe("Sure, anything else?");
    expect(synthesize).toHaveBeenCalledWith("Sure, anything else?", expect.stringMatching(/^(uk|us)$/));
  });

  it("/talk: silence is not sent to the partner", async () => {
    const { h, talkReply } = await setup(vi.fn(async () => "  "));
    await h.bot.handleUpdate(h.message(100, "/talk"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "☕ В кафе")));
    await vi.waitFor(() => expect(talkReply).toHaveBeenCalledTimes(1));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Не расслышал"));
    expect(talkReply).toHaveBeenCalledTimes(1);
  });

  it("/pron: shows what the listener understood and the sounds, and keeps the sample", async () => {
    const samples = mkdtempSync(join(tmpdir(), "voice-samples-"));
    const { h, pronunciation } = await setup(vi.fn(async () => "Sod."), samples);
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    expect(texts(h).at(-1)).toContain("Скажи голосовым: <b>thought</b>");
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Совпадение звуков: 20%"));
    expect(pronunciation).toHaveBeenCalledWith(Buffer.from("ogg-bytes"), "thought", "any");
    const report = texts(h).at(-1)!;
    expect(report).toContain("«Sod.» ❌");
    expect(report).toContain("/θɔːt/");
    expect(report).toContain("θɔːt → sod");
    await vi.waitFor(() => expect(readdirSync(samples).filter((f) => f.endsWith(".ogg"))).toHaveLength(1));
    const line = JSON.parse(readFileSync(join(samples, "samples.jsonl"), "utf8"));
    expect(line).toMatchObject({ text: "thought", whisper: "Sod.", score: 0.2 });
  });

  it("/pron uk: the accent is passed on", async () => {
    const { h, pronunciation } = await setup(vi.fn(async () => "Thought"));
    await h.bot.handleUpdate(h.message(100, "/pron uk figure out"));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(pronunciation).toHaveBeenCalledWith(expect.anything(), "figure out", "uk"));
  });

  it("a voice outside /talk and /pron gets a hint; too long ones are refused", async () => {
    const { h, transcribe } = await setup();
    await h.bot.handleUpdate(h.voiceMessage(100));
    expect(texts(h).at(-1)).toContain("/talk");
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    await h.bot.handleUpdate(h.voiceMessage(100, 600));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Слишком длинное"));
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("sameWords ignores case and punctuation", () => {
    expect(sameWords("Thought.", "thought")).toBe(true);
    expect(sameWords("Figure it out!", "figure it out")).toBe(true);
    expect(sameWords("taught", "thought")).toBe(false);
  });
});
