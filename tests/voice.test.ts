import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sameWords, soundsHint } from "../src/bot/handlers/pronounce";
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

async function setup(transcribe: SpeechRecognizer["transcribe"] = vi.fn(async () => "I'd like a latte"), samples?: string) {
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

  // Голосовое ученика скачивается как «ogg-bytes», озвучка диктора — «ogg»: распознаём их по-разному.
  const listener = (learner: string, speaker = "thought") => vi.fn(async (audio: Buffer) => (audio.toString() === "ogg-bytes" ? learner : speaker));

  it("/pron: not understood — what was heard, where the sounds differ, the speaker as a reference; the sample is kept", async () => {
    const samples = mkdtempSync(join(tmpdir(), "voice-samples-"));
    const { h, pronunciation, synthesize } = await setup(listener("Sod."), samples);
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    expect(texts(h).at(-1)).toContain("Скажи голосовым: <b>thought</b>");
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("могут не понять"));
    expect(synthesize).toHaveBeenCalledWith("thought", "uk");
    expect(synthesize).toHaveBeenCalledWith("thought", "us");
    expect(pronunciation).toHaveBeenCalledWith(Buffer.from("ogg-bytes"), "thought", "any", [
      { accent: "uk", audio: Buffer.from("ogg") },
      { accent: "us", audio: Buffer.from("ogg") },
    ]);
    const report = texts(h).at(-1)!;
    expect(report).toContain("Услышал как: «Sod.»");
    expect(report).toContain("Звучит совсем иначе, чем у диктора"); // score 0.2
    expect(report).not.toContain("%");
    expect(() => buttonData(h.calls, "🎲 Другое слово")).not.toThrow();
    await vi.waitFor(() => expect(readdirSync(samples).filter((f) => f.endsWith(".ogg"))).toHaveLength(1));
    const line = JSON.parse(readFileSync(join(samples, "samples.jsonl"), "utf8"));
    expect(line).toMatchObject({ text: "thought", whisper: "Sod.", blind: false, score: 0.2 });
  });

  it("/pron: understood — ✅ without a sounds lecture", async () => {
    const { h } = await setup(listener("Thought."));
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("✅ <b>thought</b> — поймут!"));
    expect(texts(h).at(-1)).not.toContain("🔎");
  });

  it("/pron: a word the recogniser misses even from the speaker is judged by sounds only", async () => {
    const { h } = await setup(listener("Edge", "Edge"));
    await h.bot.handleUpdate(h.message(100, "/pron etch"));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("сужу только по звукам"));
    expect(texts(h).at(-1)).toContain("могут не понять"); // score 0.2 < 0.75
  });

  it("/pron: the word can be listened to before recording, without synthesising again", async () => {
    const { h, synthesize } = await setup();
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🔊 UK")));
    await vi.waitFor(() => expect(h.calls.some((c) => c.method === "sendVoice")).toBe(true));
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(() => buttonData(h.calls, "🔊 US")).not.toThrow();
  });

  it("/pron uk: the accent is passed on", async () => {
    const { h, pronunciation, synthesize } = await setup(vi.fn(async () => "Thought"));
    await h.bot.handleUpdate(h.message(100, "/pron uk figure out"));
    await h.bot.handleUpdate(h.voiceMessage(100));
    await vi.waitFor(() => expect(pronunciation).toHaveBeenCalledWith(expect.anything(), "figure out", "uk", [{ accent: "uk", audio: Buffer.from("ogg") }]));
    expect(synthesize).toHaveBeenCalledTimes(1);
    // Свой акцент — одна кнопка послушать.
    const markup = h.calls.find((c) => String(c.payload.text).includes("figure out"))!.payload.reply_markup as { inline_keyboard: unknown[][] };
    expect(markup.inline_keyboard.flat()).toHaveLength(1);
  });

  it("a voice outside /talk and /pron gets a hint; too long ones are refused", async () => {
    const { h, transcribe } = await setup();
    await h.bot.handleUpdate(h.voiceMessage(100));
    expect(texts(h).at(-1)).toContain("/talk");
    await h.bot.handleUpdate(h.message(100, "/pron thought"));
    await h.bot.handleUpdate(h.voiceMessage(100, 600));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Слишком длинное"));
    // Распознавали только диктора (проверка слова), голосовое ученика — нет.
    expect(transcribe).not.toHaveBeenCalledWith(Buffer.from("ogg-bytes"));
  });

  it("sameWords ignores case, punctuation and spaces", () => {
    expect(sameWords("Thought.", "thought")).toBe(true);
    expect(sameWords("Figure it out!", "figure it out")).toBe(true);
    expect(sameWords("Backrub.", "back rub")).toBe(true);
    expect(sameWords("Back to back.", "back-to-back")).toBe(true);
    expect(sameWords("taught", "thought")).toBe(false);
    expect(sameWords("", "thought")).toBe(false);
  });

  it("soundsHint: the most noticeable spots with their place in the word", () => {
    const hint = soundsHint({
      heard: ["l", "ɑ", "s", "u"],
      expected: ["ɹ", "ɪ", "z", "u", "m"],
      score: 0.4,
      accent: "us",
      diff: [
        { op: "replace", expected: ["ɹ", "ɪ", "z"], heard: ["l", "ɑ", "s"] },
        { op: "equal", expected: ["u"], heard: ["u"] },
        { op: "delete", expected: ["m"], heard: [] },
      ],
    });
    expect(hint).toBe("в начале /ɹɪz/ звучит как /lɑs/\nв конце не слышно /m/");
    // Почти ничего не совпало или кусок звучит совсем по-другому — без разбора по звукам.
    expect(soundsHint({ heard: ["k", "t", "u", "v", "ɛ", "k"], expected: ["k", "ɹ", "æ", "k"], score: 0.5, accent: "us", diff: [{ op: "equal", expected: ["k"], heard: ["k"] }, { op: "replace", expected: ["ɹ", "æ"], heard: ["t", "u", "v", "ɛ"] }, { op: "equal", expected: ["k"], heard: ["k"] }] })).toBe(
      "Звучит совсем иначе, чем у диктора",
    );
    expect(soundsHint({ heard: ["l", "ɑ"], expected: ["ɹ", "ɪ", "z"], score: 0.1, accent: "us", diff: [{ op: "replace", expected: ["ɹ", "ɪ", "z"], heard: ["l", "ɑ"] }] })).toBe(
      "Звучит совсем иначе, чем у диктора",
    );
  });
});
