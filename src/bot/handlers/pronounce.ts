import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InlineKeyboard, InputFile, type Bot } from "grammy";
import { listRoomWords } from "../../services/words";
import type { PhonemeDiff, Pronunciation } from "../../speech/stt";
import type { Accent } from "../../speech/tts";
import { decodeCb, encodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { endLongModes } from "../pending";
import { esc } from "../texts";
import { voiceAudio } from "../voice-input";

/**
 * 🎤 /pron — проверка произношения. Главное — поймут ли: Whisper слушает без подсказки, как собеседник.
 * Не понял — подсказка по звукам от модели фонем (с чем сравнить: эталон espeak и то, что она слышит у диктора).
 * Слово, которое Whisper не узнаёт даже у диктора (etch → «Edge»), оцениваем только по звукам.
 * Записи с результатами копятся в deps.voiceSamplesDir — чтобы понять, насколько проверке можно верить.
 */
const TARGET_TTL_MS = 15 * 60_000;
/** Без Whisper — по звукам: столько совпадения с ближайшим эталоном считаем «похоже». */
const SOUNDS_OK = 0.75;
/** Меньше — звуки толком не выравниваются с эталоном, разбор по ним только запутает. */
const SOUNDS_ALIGNED = 0.35;
/** Кусок длиннее (звуков с любой стороны) — уже не «звук не тот», а «звучит иначе». */
const MAX_SPOT = 3;
const DIFFERENT = "Звучит совсем иначе, чем у диктора";

interface Prepared {
  /** Как говорит диктор — для 🔊 и как эталон звуков. */
  audio: Partial<Record<Accent, Buffer>>;
  /** Whisper не узнаёт слово даже у диктора: судим только по звукам. */
  blind: boolean;
}

interface Target {
  text: string;
  accent: Accent | "any";
  chatId: number;
  at: number;
  prepared: Promise<Prepared>;
}

const accentsOf = (accent: Accent | "any"): Accent[] => (accent === "any" ? ["uk", "us"] : [accent]);

/** Только буквы: «Thought.» = «thought», «Backrub» = «back rub», «Back to back» = «back-to-back». */
export function sameWords(heard: string, expected: string): boolean {
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "");
  return letters(heard) !== "" && letters(heard) === letters(expected);
}

/** Озвучить слово диктором и проверить, узнаёт ли его Whisper. */
async function prepare(deps: Deps, text: string, accent: Accent | "any"): Promise<Prepared> {
  const audio: Partial<Record<Accent, Buffer>> = {};
  const recognised: boolean[] = [];
  for (const a of accentsOf(accent)) {
    try {
      audio[a] = await deps.speech.synthesize(text, a);
      recognised.push(sameWords(await deps.recognizer!.transcribe(audio[a]), text));
    } catch (err) {
      console.error("Pron reference failed", text, a, err);
    }
  }
  return { audio, blind: recognised.length > 0 && !recognised.some(Boolean) };
}

const ipa = (phones: string[]) => `/${esc(phones.join(""))}/`;

/** Где расхождение: самые заметные куски (до двух), с местом в слове. */
export function soundsHint(p: Pronunciation): string | undefined {
  let pos = 0;
  const spots: Array<{ d: PhonemeDiff; at: number }> = [];
  for (const d of p.diff) {
    if (d.op !== "equal") spots.push({ d, at: pos });
    pos += d.expected.length;
  }
  if (!spots.length) return undefined;
  // Есть кусок, который звучит совсем по-другому, — мелкие отличия рядом с ним только отвлекут.
  if (p.score < SOUNDS_ALIGNED || spots.some(({ d }) => Math.max(d.expected.length, d.heard.length) > MAX_SPOT)) return DIFFERENT;
  const total = Math.max(p.expected.length, 1);
  const where = (at: number) => (at / total < 0.34 ? "в начале" : at / total > 0.66 ? "в конце" : "в середине");
  return spots
    .sort((a, b) => b.d.expected.length + b.d.heard.length - (a.d.expected.length + a.d.heard.length))
    .slice(0, 2)
    .sort((a, b) => a.at - b.at)
    .map(({ d, at }) =>
      d.op === "replace"
        ? `${where(at)} ${ipa(d.expected)} звучит как ${ipa(d.heard)}`
        : d.op === "delete"
          ? `${where(at)} не слышно ${ipa(d.expected)}`
          : `${where(at)} лишний звук ${ipa(d.heard)}`,
    )
    .join("\n");
}

export function pronunciationText(text: string, whisper: string, p: Pronunciation, blind: boolean): string {
  const ok = blind ? p.score >= SOUNDS_OK : sameWords(whisper, text);
  const lines = [ok ? `✅ <b>${esc(text)}</b> — ${blind ? "звучит похоже" : "поймут"}!` : `❌ <b>${esc(text)}</b> — могут не понять`];
  if (blind) lines.push("", `⚠️ Это слово распознаватель путает даже у диктора — сужу только по звукам.`);
  else lines.push("", ok ? `👂 Распознал: «${esc(whisper)}»` : `👂 Услышал как: «${esc(whisper || "…")}»`);
  const hint = ok ? undefined : soundsHint(p);
  if (hint) lines.push("", `🔎 ${hint.replace(/\n/g, "\n🔎 ")}`);
  if (!ok) lines.push("", "Послушай, как надо, сравни со своей записью и попробуй ещё раз.");
  return lines.join("\n");
}

/** 🔊 Как надо (своего акцента — одна кнопка, без выбора — обе) и 🎲 другое слово. */
function pronKeyboard(accent: Accent | "any", next: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const a of accentsOf(accent)) kb.text(`🔊 ${a.toUpperCase()}`, encodeCb({ k: "pronListen", accent: a }));
  if (next) kb.row().text("🎲 Другое слово", encodeCb({ k: "pronNext" }));
  return kb;
}

async function pickWord(deps: Deps, ctx: BotContext, not?: string): Promise<string | undefined> {
  if (ctx.user.currentRoomId == null) return undefined;
  const words = (await listRoomWords(deps.db, ctx.user.currentRoomId)).filter((w) => w.term.split(" ").length <= 3 && w.term !== not);
  return words.length ? words[Math.floor(deps.random() * words.length)].term : undefined;
}

async function saveSample(deps: Deps, ctx: BotContext, audio: Buffer, record: Record<string, unknown>): Promise<void> {
  if (!deps.voiceSamplesDir) return;
  await mkdir(deps.voiceSamplesDir, { recursive: true });
  const file = `${Date.now()}-${ctx.user.id}.ogg`;
  await writeFile(join(deps.voiceSamplesDir, file), audio);
  await appendFile(join(deps.voiceSamplesDir, "samples.jsonl"), `${JSON.stringify({ file, userId: ctx.user.id, ...record })}\n`);
}

export function registerPronounce(bot: Bot<BotContext>, deps: Deps): void {
  const targets = new Map<number, Target>();

  async function ask(ctx: BotContext, text: string, accent: Accent | "any"): Promise<void> {
    endLongModes(deps, ctx.user.id);
    const prepared = prepare(deps, text, accent);
    targets.set(ctx.user.id, { text, accent, chatId: ctx.chat!.id, at: Date.now(), prepared });
    await ctx.reply(`🎤 Скажи голосовым: <b>${esc(text)}</b>\n\nМожно сначала послушать, как звучит.`, { ...HTML, reply_markup: pronKeyboard(accent, false) });
  }

  bot.command("pron", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Произношение — в личке: https://t.me/${deps.botUsername}`));
    if (!deps.recognizer) return void (await ctx.reply("Проверка произношения сейчас недоступна 😔"));
    const [first, ...rest] = ctx.match.trim().split(/\s+/).filter(Boolean);
    const accent: Accent | "any" = first === "uk" || first === "us" ? first : "any";
    const own = (accent === "any" ? [first, ...rest] : rest).filter(Boolean).join(" ");
    const text = own || (await pickWord(deps, ctx));
    if (!text) return void (await ctx.reply("Напиши слово или фразу: /pron thought"));
    await ask(ctx, text, accent);
  });

  bot.callbackQuery(/^pn$/, async (ctx) => {
    void ctx.answerCallbackQuery().catch(() => {});
    const old = targets.get(ctx.user.id);
    const text = await pickWord(deps, ctx, old?.text);
    if (!text) return void (await ctx.reply("В словаре пока нет слов — напиши своё: /pron thought"));
    await ask(ctx, text, old?.accent ?? "any");
  });

  bot.callbackQuery(/^pl:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    const target = targets.get(ctx.user.id);
    if (cb?.k !== "pronListen" || !target) return void (await ctx.answerCallbackQuery({ text: "Задание устарело — /pron" }));
    void ctx.answerCallbackQuery().catch(() => {});
    background(ctx, async () => {
      const audio = (await target.prepared).audio[cb.accent];
      if (!audio) return void (await ctx.reply("Озвучка недоступна 😔"));
      await ctx.replyWithVoice(new InputFile(audio, "pronunciation.ogg"));
    });
  });

  bot.on("message:voice", async (ctx, next) => {
    const target = targets.get(ctx.user.id);
    if (!target || target.chatId !== ctx.chat.id || Date.now() - target.at > TARGET_TTL_MS) {
      targets.delete(ctx.user.id);
      if (ctx.chat.type !== "private") return next();
      return void (await ctx.reply("🎤 Голосовые понимаю в разговоре /talk и в проверке произношения /pron"));
    }
    target.at = Date.now();
    background(ctx, async () => {
      const audio = await voiceAudio(ctx, deps, ctx.message.voice);
      if (!audio) return;
      await ctx.replyWithChatAction("typing");
      let whisper: string;
      let result: Pronunciation;
      let prepared: Prepared;
      try {
        prepared = await target.prepared;
        const refs = accentsOf(target.accent).flatMap((a) => (prepared.audio[a] ? [{ accent: a, audio: prepared.audio[a] }] : []));
        whisper = (await deps.recognizer!.transcribe(audio)).trim();
        result = await deps.recognizer!.pronunciation(audio, target.text, target.accent, refs);
      } catch (err) {
        console.error("Pronunciation check failed", err);
        return void (await ctx.reply("Не получилось разобрать голосовое 😔 Попробуй ещё раз."));
      }
      await ctx.reply(pronunciationText(target.text, whisper, result, prepared.blind), {
        ...HTML,
        reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
        reply_markup: pronKeyboard(target.accent, true),
      });
      const record = { at: new Date().toISOString(), text: target.text, whisper, blind: prepared.blind, ...result };
      await saveSample(deps, ctx, audio, record).catch((err) => console.error("Voice sample not saved", err));
    });
  });
}
