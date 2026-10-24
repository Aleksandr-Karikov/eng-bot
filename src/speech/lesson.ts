import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { asc, and, eq, ne } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Db } from "../db/client";
import { cards, words, type Word } from "../db/schema";
import { macSay, RUSSIAN_VOICE, type Accent, type SpeechSynth } from "./tts";

const run = promisify(execFile);

/** Сколько слов в уроке: ~20 секунд на слово — около 7 минут. */
export const LESSON_WORDS = 20;
/** Паузы: вспомнить перевод, перед примером, между словами (секунды). */
const RECALL_PAUSE = 3;
const SHORT_PAUSE = 0.7;
const WORD_GAP = 1.5;

/** Слова для урока: начатые, слабее всего держатся в памяти — первыми. Новые (ещё не начатые) не берём. */
export async function lessonWords(db: Db, userId: number, limit = LESSON_WORDS): Promise<Word[]> {
  const rows = await db
    .select({ word: words })
    .from(cards)
    .innerJoin(words, eq(cards.wordId, words.id))
    .where(and(eq(cards.userId, userId), ne(cards.state, State.New)))
    .orderBy(asc(cards.stability))
    .limit(limit);
  return rows.map((r) => r.word);
}

/** «сдерживать (кого-то), мешать проявлять себя; испортить…» → «сдерживать, мешать проявлять себя»: на слух — коротко. */
export function spokenTranslation(translation: string): string {
  const plain = translation.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ");
  return plain
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

/** Акцент урока: британский, американский или по очереди. */
export type LessonAccent = Accent | "mix";

/**
 * Аудиоурок одним mp3: на каждое слово — оно по-английски, пауза, чтобы вспомнить, перевод по-русски, пример.
 * Английский — основным синтезом (Kokoro), русский — голосом macOS. mix — акцент чередуется, чтобы слышать оба.
 */
export async function buildLesson(speech: SpeechSynth, list: Array<Pick<Word, "term" | "translation" | "example">>, accent: LessonAccent = "mix"): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "eng-bot-lesson-"));
  try {
    let n = 0;
    const parts: string[] = [];
    /** Кусок звука → WAV 24 кГц моно: так их можно склеить без перекодирования каждого стыка. */
    const add = async (audio: Buffer) => {
      const src = join(dir, `src${++n}.m4a`);
      const wav = join(dir, `part${n}.wav`);
      await writeFile(src, audio);
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-ar", "24000", "-ac", "1", wav], { timeout: 20_000 });
      parts.push(wav);
    };
    const silences = new Map<number, string>();
    const pause = async (seconds: number) => {
      let file = silences.get(seconds);
      if (!file) {
        file = join(dir, `silence${seconds}.wav`);
        await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(seconds), file], { timeout: 20_000 });
        silences.set(seconds, file);
      }
      parts.push(file);
    };

    await add(await macSay(`Аудиоурок. ${list.length} слов. После английского слова — пауза: вспомни перевод.`, RUSSIAN_VOICE, "m4a"));
    await pause(WORD_GAP);
    for (const [i, word] of list.entries()) {
      const voice: Accent = accent === "mix" ? (i % 2 ? "us" : "uk") : accent;
      await add(await speech.synthesize(word.term, voice, "m4a"));
      await pause(RECALL_PAUSE);
      await add(await macSay(spokenTranslation(word.translation) || word.translation, RUSSIAN_VOICE, "m4a"));
      if (word.example) {
        await pause(SHORT_PAUSE);
        await add(await speech.synthesize(word.example, voice, "m4a"));
      }
      await pause(WORD_GAP);
    }
    await add(await macSay("Урок окончен. Повторить можно в любой момент.", RUSSIAN_VOICE, "m4a"));

    const list_ = join(dir, "list.txt");
    await writeFile(list_, parts.map((p) => `file '${p}'`).join("\n"));
    const out = join(dir, "lesson.mp3");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list_, "-c:a", "libmp3lame", "-b:a", "64k", out], { timeout: 120_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
