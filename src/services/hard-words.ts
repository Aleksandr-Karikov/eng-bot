import { RetryLater } from "./retry-later";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs } from "../db/schema";
import type { ExerciseTutor, LeechHelp } from "../llm/tutor";
import { withLang, type LangCode } from "../lang";
import type { Word } from "../db/schema";
import { getWord, setLeechHelp, setMnemonic, wordLanguage } from "./words";

/** После стольких «Забыл» слово считается трудным для этого пользователя — ему показываем запоминалку. */
export const HARD_AFTER_LAPSES = 4;
const MANY_CHUNK = 20;

export async function forgotCount(db: Db, cardId: number): Promise<number> {
  const rows = await db
    .select({ id: reviewLogs.id })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.cardId, cardId), eq(reviewLogs.rating, "again")));
  return rows.length;
}

/** Каждые столько «Забыл» подряд по счёту — разбор слова; на предыдущем — готовим его заранее. */
export const LEECH_EVERY = 4;

/** Пора ли показать разбор: этот ответ — «Забыл», и он 4-й, 8-й… по счёту. prefetch — следующий «Забыл» будет таким. */
export async function leechMoment(db: Db, cardId: number): Promise<{ show: boolean; prefetch: boolean; forgot: number }> {
  const [last] = await db.select({ rating: reviewLogs.rating }).from(reviewLogs).where(eq(reviewLogs.cardId, cardId)).orderBy(desc(reviewLogs.id)).limit(1);
  const forgot = await forgotCount(db, cardId);
  if (last?.rating !== "again" || forgot === 0) return { show: false, prefetch: false, forgot };
  return { show: forgot % LEECH_EVERY === 0, prefetch: forgot % LEECH_EVERY === LEECH_EVERY - 1, forgot };
}

export async function isHard(db: Db, cardId: number): Promise<boolean> {
  return (await forgotCount(db, cardId)) >= HARD_AFTER_LAPSES;
}

/** Готовит запоминалку для слова в фоне — один запрос к Claude на слово, даже если попросили несколько раз. */
export class MnemonicGenerator {
  private readonly inFlight = new Map<number, Promise<void>>();

  private readonly helpInFlight = new Map<number, Promise<LeechHelp | undefined>>();
  private readonly retry = new RetryLater();

  constructor(
    private readonly db: Db,
    private readonly tutor: ExerciseTutor,
  ) {}

  /** Разбор трудного слова: из базы или свежий от Claude (и сохраняется для всей комнаты). undefined — не вышло. */
  help(wordId: number): Promise<LeechHelp | undefined> {
    const running = this.helpInFlight.get(wordId);
    if (running) return running;
    if (this.retry.blocked(wordId)) return Promise.resolve(undefined);
    const task = this.loadHelp(wordId)
      .catch((err) => {
        this.retry.failed(wordId);
        console.error("Leech help failed", wordId, err);
        return undefined;
      })
      .finally(() => this.helpInFlight.delete(wordId));
    this.helpInFlight.set(wordId, task);
    return task;
  }

  private async loadHelp(wordId: number): Promise<LeechHelp | undefined> {
    const word = await getWord(this.db, wordId);
    if (!word) return undefined;
    if (word.leechHelp) return JSON.parse(word.leechHelp) as LeechHelp;
    const help = await withLang(await wordLanguage(this.db, wordId), () => this.tutor.untangle(word));
    const fresh = await getWord(this.db, wordId);
    if (fresh && fresh.term === word.term && fresh.translation === word.translation) await setLeechHelp(this.db, wordId, JSON.stringify(help));
    return help;
  }

  ensure(wordId: number): Promise<void> {
    const running = this.inFlight.get(wordId);
    if (running) return running;
    const task = this.generate(wordId)
      .catch((err) => console.error("Mnemonic generation failed", wordId, err))
      .finally(() => this.inFlight.delete(wordId));
    this.inFlight.set(wordId, task);
    return task;
  }

  /** Пачкой (по 20 на запрос) для слов, у которых запоминалки ещё нет, — например, после /text. */
  async ensureMany(wordIds: number[]): Promise<void> {
    const words = [];
    for (const id of wordIds) {
      const w = await getWord(this.db, id);
      if (w && !w.mnemonic) words.push(w);
    }
    // Слова из разных комнат могут быть на разных языках — пачки внутри одного языка.
    const byLang = new Map<LangCode, typeof words>();
    for (const w of words) {
      const lang = await wordLanguage(this.db, w.id);
      byLang.set(lang, [...(byLang.get(lang) ?? []), w]);
    }
    for (const [lang, list] of byLang) await withLang(lang, () => this.ensureChunks(list));
  }

  private async ensureChunks(words: Word[]): Promise<void> {
    for (let i = 0; i < words.length; i += MANY_CHUNK) {
      const chunk = words.slice(i, i + MANY_CHUNK);
      const finals = await this.tutor.mnemonics(chunk.map((w) => ({ term: w.term, translation: w.translation })));
      for (const [k, w] of chunk.entries()) {
        const fresh = await getWord(this.db, w.id);
        if (finals[k] && fresh && !fresh.mnemonic && fresh.term === w.term && fresh.translation === w.translation) {
          await setMnemonic(this.db, w.id, finals[k]);
        }
      }
    }
  }

  private async generate(wordId: number): Promise<void> {
    const word = await getWord(this.db, wordId);
    if (!word || word.mnemonic) return;
    const [mnemonic] = await withLang(await wordLanguage(this.db, wordId), () => this.tutor.mnemonics([{ term: word.term, translation: word.translation }]));
    if (!mnemonic) return;
    const fresh = await getWord(this.db, wordId);
    // Пока Claude думал, слово могли удалить или изменить — тогда запоминалка уже не к месту.
    if (fresh && !fresh.mnemonic && fresh.term === word.term && fresh.translation === word.translation) {
      await setMnemonic(this.db, wordId, mnemonic);
    }
  }
}
