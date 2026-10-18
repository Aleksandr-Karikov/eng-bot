import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** YouTube не пустил без входа в аккаунт (часто — для адресов VPN). */
export class YoutubeBlockedError extends Error {}

const YOUTUBE_URL = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;

export function findYoutubeUrl(text: string): string | undefined {
  return YOUTUBE_URL.exec(text)?.[0];
}

/** Текст из WebVTT: без таймкодов и тегов; автосубтитры повторяют строки «лесенкой» — склеиваем повторы. */
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .trim();
    if (!line || line === "WEBVTT" || line.includes("-->") || /^(Kind|Language|NOTE|STYLE)\b/.test(line) || /^\d+$/.test(line)) continue;
    if (lines.at(-1) === line) continue;
    lines.push(line);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Через yt-dlp; cookiesBrowser — взять вход в YouTube из браузера (safari, chrome…), если без него не пускают. */
export class YtDlpSubtitles implements SubtitleSource {
  private readonly bin: string;

  constructor(
    bin: string,
    private readonly cookiesBrowser?: string,
  ) {
    this.bin = resolve(bin);
  }

  async fetch(url: string): Promise<Subtitles | undefined> {
    const dir = await mkdtemp(join(tmpdir(), "eng-bot-yt-"));
    try {
      const args = [
        "--js-runtimes", "node",
        "--skip-download", "--write-subs", "--write-auto-subs",
        "--sub-langs", "en,en-orig,en-.*", "--sub-format", "vtt",
        "--no-playlist", "-o", "sub",
        "--print-to-file", "%(title)s", "title.txt",
        ...(this.cookiesBrowser ? ["--cookies-from-browser", this.cookiesBrowser] : []),
        // Ссылка — отдельный аргумент без shell, после «--»: её нельзя выдать за параметр.
        "--", url,
      ];
      try {
        await run(this.bin, args, { cwd: dir, timeout: 120_000 });
      } catch (err) {
        const stderr = String((err as { stderr?: string }).stderr ?? "");
        if (/Sign in to confirm|cookies/i.test(stderr)) throw new YoutubeBlockedError(stderr.slice(0, 300));
        throw err;
      }
      const files = await readdir(dir);
      const title = files.includes("title.txt") ? (await readFile(join(dir, "title.txt"), "utf8")).trim() : "";
      // Ручные английские субтитры лучше автоматических: en.vtt раньше en-orig/en-xx.
      const sub = files.filter((f) => f.endsWith(".vtt")).sort((a, b) => a.length - b.length)[0];
      if (!sub) return undefined;
      const text = vttToText(await readFile(join(dir, sub), "utf8"));
      return text ? { title, text } : undefined;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
