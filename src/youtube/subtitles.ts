import { currentLang } from "../lang";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Субтитры видео: название и текст (английский). */
export interface Subtitles {
  title: string;
  text: string;
}

export interface SubtitleSource {
  /** undefined — у видео нет английских субтитров. */
  fetch(url: string): Promise<Subtitles | undefined>;
}

/** YouTube не отдал расшифровку (блокирует адрес — часто адреса VPN и облаков). */
export class YoutubeBlockedError extends Error {}

const YOUTUBE_URL = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;

export function findYoutubeUrl(text: string): string | undefined {
  return YOUTUBE_URL.exec(text)?.[0];
}

/** id видео из ссылки любого вида (watch?v=, youtu.be/, shorts/, live/, embed/). */
export function youtubeVideoId(url: string): string | undefined {
  const match = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/.exec(url);
  return match?.[1];
}

/**
 * Через youtube-transcript-api (Python): он берёт расшифровку тем же путём, что и кнопка «Расшифровка» на сайте,
 * и, в отличие от yt-dlp, не требует входа в аккаунт и токенов YouTube. Название — из oEmbed.
 */
export class TranscriptSubtitles implements SubtitleSource {
  private readonly python: string;
  private readonly script: string;

  constructor(python: string, script: string) {
    this.python = resolve(python);
    this.script = resolve(script);
  }

  async fetch(url: string): Promise<Subtitles | undefined> {
    const id = youtubeVideoId(url);
    if (!id) return undefined;
    // id проверен регуляркой (11 символов [\w-]) и передаётся отдельным аргументом без shell.
    const [{ stdout }, title] = await Promise.all([
      run(this.python, ["-I", this.script, id, currentLang().code], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }),
      this.title(id),
    ]);
    const result = JSON.parse(stdout) as { text?: string; error?: string };
    if (result.error === "blocked") throw new YoutubeBlockedError("transcript request blocked");
    const text = result.text?.replace(/\s+/g, " ").trim();
    return text ? { title, text } : undefined;
  }

  private async title(id: string): Promise<string> {
    try {
      const response = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
      return response.ok ? (((await response.json()) as { title?: string }).title ?? "") : "";
    } catch {
      return "";
    }
  }
}
