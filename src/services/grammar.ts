import { RetryLater } from "./retry-later";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { words } from "../db/schema";
import type { ExerciseTutor } from "../llm/tutor";
import { withLang } from "../lang";
import { getWord, wordLanguage } from "./words";

/** Формы слова, синонимы и антонимы — как и сочетания, готовятся в фоне. */
export interface WordGrammarRow {
  id: number;
  term: string;
  translation: string;
  partOfSpeech: string;
  cefr: string;
  forms: string;
  grammarAskedAt?: Date | null;
}

/**
 * Готово, если хоть что-то заполнено или модель уже спрашивали: у идиомы не бывает форм,
 * и без второй отметки такая карточка дёргала бы модель при каждом показе.
 */
const ready = (word: WordGrammarRow) => Boolean(word.partOfSpeech || word.forms !== "[]" || word.grammarAskedAt);

/**
 * Готовит грамматику слова в фоне — один запрос на слово, даже если попросили несколько раз.
 * Часть речи, уровень и родня нужны и в карточке, и в сравнении правок, поэтому заполняются лениво,
 * а не при добавлении: /add и так ждёт модель, лишний запрос сделал бы его вдвое дольше.
 */
export class GrammarGenerator {
  private readonly inFlight = new Map<number, Promise<void>>();
  private readonly retry = new RetryLater();

  constructor(
    private readonly db: Db,
    private readonly tutor: ExerciseTutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  ensure(word: WordGrammarRow): Promise<void> {
    if (!this.tutor.grammar || ready(word)) return Promise.resolve();
    const running = this.inFlight.get(word.id);
    if (running) return running;
    if (this.retry.blocked(word.id)) return Promise.resolve();
    const task = this.generate(word)
      .catch((err) => {
        this.retry.failed(word.id);
        console.error("Grammar failed", word.term, err);
      })
      .finally(() => this.inFlight.delete(word.id));
    this.inFlight.set(word.id, task);
    return task;
  }

  private async generate(word: WordGrammarRow): Promise<void> {
    const lang = await wordLanguage(this.db, word.id);
    const generated = await withLang(lang, () => this.tutor.grammar!(word.term, word.translation));
    const fresh = await getWord(this.db, word.id);
    // Пока Claude думал, слово могли изменить — тогда часть речи и родня уже не к нему.
    if (!fresh || ready(fresh) || fresh.term !== word.term || fresh.translation !== word.translation) return;
    await this.db
      .update(words)
      .set({
        partOfSpeech: generated.partOfSpeech,
        cefr: generated.cefr,
        forms: JSON.stringify(generated.forms),
        synonyms: JSON.stringify(generated.synonyms),
        antonyms: JSON.stringify(generated.antonyms),
        grammarAskedAt: this.now(),
      })
      .where(eq(words.id, word.id));
  }
}
