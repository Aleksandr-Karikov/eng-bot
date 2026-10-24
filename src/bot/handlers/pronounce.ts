import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bot } from "grammy";
import { listRoomWords } from "../../services/words";
import type { Pronunciation } from "../../speech/stt";
import type { Accent } from "../../speech/tts";
import { background, HTML, type BotContext, type Deps } from "../context";
import { endLongModes } from "../pending";
import { esc } from "../texts";
import { voiceAudio } from "../voice-input";

/**
 * 🎤 /pron — эксперимент с проверкой произношения: человек говорит слово голосовым, бот показывает,
 * что понял Whisper (поймёт ли собеседник) и какие звуки услышала модель фонем по сравнению с эталоном.
 * Записи с результатами копятся в deps.voiceSamplesDir — по ним решим, можно ли модели верить.
 */
const TARGET_TTL_MS = 15 * 60_000;

interface Target {
  text: string;
  accent: Accent | "any";
  chatId: number;
  at: number;
}

/** Слова без регистра и знаков: «Thought.» и «thought» — одно и то же. */
export function sameWords(heard: string, expected: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z' ]+/g, " ").split(" ").filter(Boolean).join(" ");
  return words(heard) === words(expected);
}

function diffText(p: Pronunciation): string {
  const parts = p.diff
    .filter((d) => d.op !== "equal")
    .map((d) => (d.op === "replace" ? `${d.expected.join("")} → ${d.heard.join("")}` : d.op === "delete" ? `нет ${d.expected.join("")}` : `лишнее ${d.heard.join("")}`));
  return parts.length ? `Отличия: ${parts.map(esc).join(" · ")}` : "Звуки совпали с эталоном 👌";
}

export function pronunciationText(text: string, whisper: string, p: Pronunciation): string {
  const understood = sameWords(whisper, text);
  return [
    `🎤 <b>${esc(text)}</b>`,
    "",
    `👂 Собеседник поймёт как: «${esc(whisper)}» ${understood ? "✅" : "❌"}`,
    `🔤 Эталон (${p.accent.toUpperCase()}): /${esc(p.expected.join(""))}/`,
    `🗣 Твои звуки: /${esc(p.heard.join(""))}/`,
    `📊 Совпадение звуков: ${Math.round(p.score * 100)}%`,
    diffText(p),
    "",
    "Запиши ещё раз или /pron — другое слово.",
  ].join("\n");
}

async function pickWord(deps: Deps, ctx: BotContext): Promise<string | undefined> {
  if (ctx.user.currentRoomId == null) return undefined;
  const words = (await listRoomWords(deps.db, ctx.user.currentRoomId)).filter((w) => w.term.split(" ").length <= 3);
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

  bot.command("pron", async (ctx) => {
    if (ctx.chat.type !== "private") return void (await ctx.reply(`Произношение — в личке: https://t.me/${deps.botUsername}`));
    if (!deps.recognizer) return void (await ctx.reply("Проверка произношения сейчас недоступна 😔"));
    const [first, ...rest] = ctx.match.trim().split(/\s+/).filter(Boolean);
    const accent: Accent | "any" = first === "uk" || first === "us" ? first : "any";
    const own = (accent === "any" ? [first, ...rest] : rest).filter(Boolean).join(" ");
    const text = own || (await pickWord(deps, ctx));
    if (!text) return void (await ctx.reply("Напиши слово: /pron thought"));
    endLongModes(deps, ctx.user.id);
    targets.set(ctx.user.id, { text, accent, chatId: ctx.chat.id, at: Date.now() });
    await ctx.reply(`🎤 Скажи голосовым: <b>${esc(text)}</b>\n\nЭто эксперимент — пришли пару раз как надо и пару раз нарочно с ошибкой.`, HTML);
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
      try {
        whisper = (await deps.recognizer!.transcribe(audio)).trim();
        result = await deps.recognizer!.pronunciation(audio, target.text, target.accent);
      } catch (err) {
        console.error("Pronunciation check failed", err);
        return void (await ctx.reply("Не получилось разобрать голосовое 😔 Попробуй ещё раз."));
      }
      await ctx.reply(pronunciationText(target.text, whisper, result), HTML);
      await saveSample(deps, ctx, audio, { at: new Date().toISOString(), text: target.text, whisper, ...result }).catch((err) => console.error("Voice sample not saved", err));
    });
  });
}
